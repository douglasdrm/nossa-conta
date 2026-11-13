import { checkOrigin, failure, ApiError } from "@/lib/api";
import { asaas, billingOrigin, sandboxConfig } from "@/lib/asaas";
import { billingAdmin, recordResult, linkSandboxSubscription } from "@/lib/billing-server";
import { monitoredAsaasEvents } from "@/lib/asaas-lifecycle";
import { matchesLegacySandboxSubscription, type SandboxSubscriptionCandidate } from "@/lib/asaas-reconcile";
import { sandboxEntitlementPreview } from "@/lib/sandbox-entitlement";
const events = [
  "CHECKOUT_CREATED",
  "CHECKOUT_PAID",
  "CHECKOUT_CANCELED",
  "CHECKOUT_EXPIRED",
  ...monitoredAsaasEvents,
];
type Hook = { id: string; url: string; enabled: boolean; interrupted: boolean };
export async function GET() {
  try {
    const { db } = await billingAdmin();
    const { data: orders, error } = await db
      .from("nc_billing_orders")
      .select("id,cycle,method,amount,status,created_at,sandbox_valid_until,checkout_id,provider_subscription_id")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error("Não foi possível consultar os testes.");
    const { data: lifecycleEvents, error: eventsError } = await db
      .from("nc_billing_lifecycle_events")
      .select("id,order_id,resource_type,event_type,created_at")
      .order("created_at", { ascending: false }).limit(40);
    if (eventsError) throw new Error("Não foi possível consultar o histórico de recorrência.");
    const { data: hooks } = await asaas<{ data: Hook[] }>(
      "/webhooks?limit=100",
    );
    const hook = hooks.find(
      (h) => h.url === billingOrigin + "/api/billing/webhook",
    );
    return Response.json({
      environment: "sandbox",
      connected: true,
      webhook: !!hook?.enabled && !hook.interrupted,
      lifecycleEvents: lifecycleEvents ?? [],
      orders: (orders ?? []).map((order) => ({
        ...order,
        sandbox_entitlement: sandboxEntitlementPreview(order as Parameters<typeof sandboxEntitlementPreview>[0]),
      })),
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, user } = await billingAdmin();
    const { action, id } = await request.json();
    if (action === "connect") {
      const { data: hooks } = await asaas<{ data: Hook[] }>(
        "/webhooks?limit=100",
      );
      const url = billingOrigin + "/api/billing/webhook";
      const existing = hooks.find((h) => h.url === url);
      const payload = {
        name: "Nossa Conta — Sandbox",
        url,
        email: user.email,
        enabled: true,
        interrupted: false,
        authToken: sandboxConfig().token,
        sendType: "SEQUENTIALLY",
        events,
      };
      await asaas(
        existing ? "/webhooks/" + encodeURIComponent(existing.id) : "/webhooks",
        payload,
        existing ? "PUT" : "POST",
      );
      return Response.json({ ok: true });
    }
    if ((action === "find-subscriptions" || action === "link-subscription") &&
        typeof id === "string") {
      const { data: order, error } = await db.from("nc_billing_orders")
        .select("id,checkout_id,amount,method,cycle,status,created_at,provider_subscription_id")
        .eq("id", id).single();
      if (error || !order || !order.checkout_id) throw new ApiError("Pedido não encontrado.", 404);
      if (order.method !== "card" || order.status !== "paid" || order.provider_subscription_id) {
        throw new ApiError("Esse pedido não precisa de conciliação manual.", 409);
      }
      // Read-only listing from Asaas Sandbox; never create a second subscription.
      // Scan a bounded window to avoid making expensive API queries.
      const candidates: SandboxSubscriptionCandidate[] = [];
      for (let offset = 0; offset < 300; offset += 100) {
        const page = await asaas<{ data: SandboxSubscriptionCandidate[]; hasMore?: boolean }>(
          "/subscriptions?limit=100&offset=" + offset + "&billingType=CREDIT_CARD"
        );
        candidates.push(...page.data.filter((s) => matchesLegacySandboxSubscription(order, s)));
        if (!page.hasMore) break;
      }
      if (action === "find-subscriptions") {
        return Response.json({
          ok: true,
          candidates: candidates.map((s) => ({
            id: s.id, value: s.value, cycle: s.cycle,
            dateCreated: s.dateCreated, nextDueDate: s.nextDueDate,
          })),
        });
      }
      const { subscriptionId, confirmed } = await request.json().catch(() => ({}));
      if (confirmed !== true || typeof subscriptionId !== "string" ||
          !candidates.some((s) => s.id === subscriptionId)) {
        throw new ApiError("Assinatura não corresponde ao pedido ou não foi confirmada.", 400);
      }
      // Explicit administrator verification in Sandbox only; the RPC also
      // enforces an already paid checkout and one-to-one subscription IDs.
      await linkSandboxSubscription(order.id, order.checkout_id, subscriptionId);
      return Response.json({ ok: true, linked: true });
    }
    if (action === "sync" && typeof id === "string") {
      const { data: order, error } = await db
        .from("nc_billing_orders")
        .select("id,checkout_id,amount,method")
        .eq("id", id)
        .single();
      if (error || !order?.checkout_id)
        throw new ApiError("Checkout não encontrado.", 404);
      const result = await asaas<{
        data: { id: string; value: number; status: string; subscription?: string | null }[];
      }>(
        "/payments?checkoutSession=" +
          encodeURIComponent(order.checkout_id) +
          "&limit=100",
      );
      // Treat checkout confirmation and charge settlement as separate facts.
      // Only inspect values/status; never return payer identity or card details.
      const matching = result.data.filter((p) =>
        Number.isFinite(p.value) && Math.round(p.value * 100) === order.amount
      );
      const confirmed = matching.find((p) => ["RECEIVED", "CONFIRMED"].includes(p.status));
      const statuses = [...new Set(matching.map((p) => p.status))].slice(0, 10);
      if (confirmed) {
        await recordResult(order.id, order.checkout_id, "paid", undefined, order.amount);
      }
      if (order.method !== "card") {
        return Response.json({
          ok: true, linked: false, reason: confirmed ? "pix_confirmed" : "payment_not_settled",
          matchingPayments: matching.length, paymentStatuses: statuses
        });
      }
      // A paid checkout may be followed by a separate recurring subscription.
      // First use the charge's subscription ID; then search by the *exact*
      // order reference, never by customer name, e-mail or a price alone.
      let subscription = confirmed?.subscription ?? null;
      if (confirmed && !subscription) {
        const detail = await asaas<{
          id: string; value: number; status: string; subscription?: string | null;
        }>("/payments/" + encodeURIComponent(confirmed.id));
        if (detail.id === confirmed.id &&
            Math.round(detail.value * 100) === order.amount &&
            ["RECEIVED", "CONFIRMED"].includes(detail.status)) {
          subscription = detail.subscription ?? null;
        }
      }
      // This fallback is strictly scoped to the app's order UUID. A single
      // matching subscription may be linked only after checkout was already
      // confirmed by its authenticated webhook.
      if (!subscription) {
        const subs = await asaas<{
          data: { id: string; externalReference?: string | null; value: number;
            cycle: string; billingType: string }[];
        }>("/subscriptions?externalReference=" + encodeURIComponent(order.id) + "&limit=100");
        const cycle = (await db.from("nc_billing_orders").select("cycle,status").eq("id",order.id).single()).data;
        const providerCycle = cycle?.cycle === "monthly" ? "MONTHLY" :
          cycle?.cycle === "quarterly" ? "QUARTERLY" :
          cycle?.cycle === "yearly" ? "YEARLY" : null;
        const candidates = subs.data.filter((s) =>
          s.externalReference === order.id && s.billingType === "CREDIT_CARD" &&
          s.cycle === providerCycle && Math.round(s.value * 100) === order.amount &&
          /^sub_[a-zA-Z0-9_-]{6,100}$/.test(s.id)
        );
        if (cycle?.status === "paid" && candidates.length === 1) {
          subscription = candidates[0].id;
        }
      }
      if (subscription) {
        await linkSandboxSubscription(order.id, order.checkout_id, subscription);
        return Response.json({ ok: true, linked: true, reason: "subscription_linked" });
      }
      return Response.json({
        ok: true, linked: false,
        reason: matching.length === 0 ? "no_matching_payment" :
          confirmed ? "subscription_missing" : "payment_not_settled",
        matchingPayments: matching.length, paymentStatuses: statuses
      });
    }
    throw new ApiError("Operação inválida.", 400);
  } catch (error) {
    return failure(error);
  }
}
