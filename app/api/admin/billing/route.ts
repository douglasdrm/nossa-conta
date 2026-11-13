import { checkOrigin, failure, ApiError } from "@/lib/api";
import { asaas, billingOrigin, sandboxConfig } from "@/lib/asaas";
import { billingAdmin, recordResult, linkSandboxSubscription } from "@/lib/billing-server";
import { monitoredAsaasEvents } from "@/lib/asaas-lifecycle";
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
      const paid = result.data.find(
        (p) =>
          Math.round(p.value * 100) === order.amount &&
          ["RECEIVED", "CONFIRMED"].includes(p.status),
      );
      if (!paid) {
        return Response.json({ ok: true, payment: "not_confirmed", linked: false });
      }
      await recordResult(order.id, order.checkout_id, "paid", undefined, order.amount);
      if (order.method !== "card") {
        return Response.json({ ok: true, payment: "confirmed", linked: false, method: "pix" });
      }

      // A checkout payment may initially omit its recurring subscription.
      // Check the single payment resource before concluding the link is missing.
      let subscription = paid.subscription;
      if (!subscription) {
        const detail = await asaas<{
          id: string; value: number; status: string; subscription?: string | null;
        }>("/payments/" + encodeURIComponent(paid.id));
        if (detail.id === paid.id &&
            Math.round(detail.value * 100) === order.amount &&
            ["RECEIVED", "CONFIRMED"].includes(detail.status)) {
          subscription = detail.subscription;
        }
      }
      if (!subscription) {
        return Response.json({ ok: true, payment: "confirmed", linked: false, reason: "subscription_missing" });
      }
      await linkSandboxSubscription(order.id, order.checkout_id, subscription);
      return Response.json({ ok: true, payment: "confirmed", linked: true });
    }
    throw new ApiError("Operação inválida.", 400);
  } catch (error) {
    return failure(error);
  }
}
