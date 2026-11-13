import { checkOrigin, failure, ApiError } from "@/lib/api";
import { asaas, billingOrigin, sandboxConfig, generateSandboxPaymentBook } from "@/lib/asaas";
import { billingAdmin, recordResult, linkSandboxSubscription, applySandboxRenewal } from "@/lib/billing-server";
import { verifiedSandboxRenewalPayment } from "@/lib/asaas-renewal-verification";
import { monitoredAsaasEvents } from "@/lib/asaas-lifecycle";
import { matchesLegacySandboxSubscription, type SandboxSubscriptionCandidate } from "@/lib/asaas-reconcile";
import { sandboxEntitlementPreview } from "@/lib/sandbox-entitlement";
import { findRenewalCandidates, type AsaasCharge } from "@/lib/asaas-renewal-reconciliation";
import { summarizeSandboxLifecycle } from "@/lib/asaas-lifecycle-review";
import { reviewSandboxBillingRisks } from "@/lib/sandbox-billing-risk-review";
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
      .select("id,order_id,resource_type,resource_id,event_type,created_at")
      .order("created_at", { ascending: false }).limit(40);
    if (eventsError) throw new Error("Não foi possível consultar o histórico de recorrência.");
    const { data: appliedRenewals, error: renewalsError } = await db
      .from("nc_billing_sandbox_renewals")
      .select("payment_id,order_id,due_date,previous_valid_until,new_valid_until,applied_at")
      .order("applied_at", { ascending: false }).limit(30);
    if (renewalsError) throw new Error("Não foi possível consultar as renovações de teste.");
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
      appliedRenewals: appliedRenewals ?? [],
      lifecycleSummary: Object.fromEntries((orders ?? []).map((order) => [
        order.id,
        summarizeSandboxLifecycle((lifecycleEvents ?? []).filter((event) => event.order_id === order.id)),
      ])),
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
    const { action, id, subscriptionId, paymentId, confirmed } = await request.json();
    if (action === "review-sandbox-risks" && typeof id === "string") {
      const { data: order, error } = await db.from("nc_billing_orders")
        .select("id,environment,method,status,amount,provider_subscription_id,sandbox_valid_until")
        .eq("id",id).single();
      if (error || !order || order.environment !== "sandbox" ||
          order.method !== "card" || order.status !== "paid" ||
          !order.provider_subscription_id || !order.sandbox_valid_until)
        throw new ApiError("Assinatura de teste vinculada não encontrada.",409);
      // Read only: provider status is authoritative; do not make changes to
      // provider payments, subscriptions, Premium or courtesy.
      const subscription = await asaas<{id:string;status:string;nextDueDate?:string|null}>(
        "/subscriptions/" + encodeURIComponent(order.provider_subscription_id)
      );
      const list = await asaas<{data:AsaasCharge[];hasMore?:boolean}>(
        "/subscriptions/" + encodeURIComponent(order.provider_subscription_id) +
        "/payments?limit=100"
      );
      if (list.hasMore)
        throw new ApiError("Há mais de 100 cobranças; auditoria incompleta. Revisão manual necessária.",409);
      const audit = reviewSandboxBillingRisks({
        subscriptionId:order.provider_subscription_id,
        amount:order.amount,validUntil:order.sandbox_valid_until
      },subscription,list.data ?? []);
      return Response.json({ok:true,readOnly:true,review:audit});
    }
    if (action === "replay-sandbox-renewal" && typeof id === "string") {
      if (confirmed !== true || typeof paymentId !== "string" ||
          !/^pay_[A-Za-z0-9_-]{3,120}$/.test(paymentId))
        throw new ApiError("Confirmação explícita e cobrança registrada são obrigatórias.",400);
      const { data: order, error: orderError } = await db.from("nc_billing_orders")
        .select("id,environment,method,status,amount,provider_subscription_id,sandbox_valid_until")
        .eq("id",id).single();
      if (orderError || !order || order.environment !== "sandbox" ||
          order.method !== "card" || order.status !== "paid" ||
          !order.provider_subscription_id || !order.sandbox_valid_until)
        throw new ApiError("Pedido Sandbox vinculado não encontrado.",409);
      const { data: prior, error: priorError } = await db
        .from("nc_billing_sandbox_renewals")
        .select("payment_id,due_date,new_valid_until")
        .eq("order_id",id).eq("payment_id",paymentId).single();
      if (priorError || !prior) throw new ApiError("Essa cobrança ainda não foi renovada; replay bloqueado.",409);
      const beforeUntil = order.sandbox_valid_until;
      const { count: beforeCount, error: countError } = await db
        .from("nc_billing_sandbox_renewals").select("payment_id",{count:"exact",head:true})
        .eq("order_id",id);
      if (countError || beforeCount === null) throw new Error("Não foi possível ler o histórico de renovações.");
      const charge = await asaas<AsaasCharge>("/payments/" + encodeURIComponent(paymentId));
      const verified = verifiedSandboxRenewalPayment(paymentId,order.provider_subscription_id,charge);
      if (!verified || verified.amount !== order.amount || verified.dueDate !== prior.due_date ||
          new Date(beforeUntil).getTime() < new Date(prior.new_valid_until).getTime())
        throw new ApiError("Cobrança não está confirmada ou não corresponde ao histórico registrado.",409);
      // Same validation and atomic RPC as the webhook, without generating any new
      // Asaas event or changing the payment status. The expected result is duplicate.
      const result = await applySandboxRenewal(verified);
      const { data: after, error: afterError } = await db.from("nc_billing_orders")
        .select("sandbox_valid_until").eq("id",id).single();
      const { count: afterCount, error: afterCountError } = await db
        .from("nc_billing_sandbox_renewals").select("payment_id",{count:"exact",head:true})
        .eq("order_id",id);
      if (afterError || !after || afterCountError || afterCount === null)
        throw new Error("Não foi possível confirmar o resultado do replay.");
      const unchanged = beforeUntil === after.sandbox_valid_until && beforeCount === afterCount;
      return Response.json({
        ok:result === "duplicate" && unchanged,
        result,unchanged,
        renewalCountBefore:beforeCount,renewalCountAfter:afterCount,
        validityUnchanged:beforeUntil === after.sandbox_valid_until,
        validUntil:after.sandbox_valid_until,
      },{status:result === "duplicate" && unchanged ? 200 : 409});
    }
    if (action === "confirm-sandbox-renewal" && typeof id === "string") {
      if (confirmed !== true || typeof paymentId !== "string" ||
          !/^pay_[A-Za-z0-9_-]{3,120}$/.test(paymentId))
        throw new ApiError("Confirmação explícita e identificador de cobrança são obrigatórios.",400);
      const { data: order, error } = await db.from("nc_billing_orders")
        .select("id,environment,method,status,amount,cycle,provider_subscription_id,sandbox_valid_until")
        .eq("id",id).single();
      if (error || !order || order.environment !== "sandbox" ||
          order.method !== "card" || order.status !== "paid" ||
          !order.provider_subscription_id || !order.sandbox_valid_until ||
          !["monthly","quarterly","yearly"].includes(order.cycle))
        throw new ApiError("Assinatura de teste elegível não encontrada.",409);
      const path = "/subscriptions/" + encodeURIComponent(order.provider_subscription_id) + "/payments?limit=100";
      const list = await asaas<{data:AsaasCharge[];hasMore?:boolean}>(path);
      if (list.hasMore)
        throw new ApiError("A lista tem mais páginas. Confirmação bloqueada por segurança.",409);
      const candidates = findRenewalCandidates({
        cycle:order.cycle as "monthly"|"quarterly"|"yearly", amount:order.amount,
        provider_subscription_id:order.provider_subscription_id,
        sandbox_valid_until:order.sandbox_valid_until,
      },list.data ?? []);
      if (candidates.length !== 1 || candidates[0].chargeId !== paymentId)
        throw new ApiError("A cobrança não é a única candidata para o próximo vencimento.",409);
      const before = await asaas<AsaasCharge>("/payments/" + encodeURIComponent(paymentId));
      if (before.id !== paymentId ||
          before.subscription !== order.provider_subscription_id ||
          Math.round(before.value*100) !== order.amount ||
          before.dueDate !== candidates[0].dueDate)
        throw new ApiError("Cobrança não corresponde à assinatura e ao período esperado.",409);
      if (["CONFIRMED","RECEIVED"].includes(before.status)) {
        const verified = verifiedSandboxRenewalPayment(paymentId,order.provider_subscription_id,before);
        if (!verified) throw new ApiError("Dados da cobrança inconsistentes.",409);
        const result = await applySandboxRenewal(verified);
        return Response.json({ok:true,result,alreadyPaid:true});
      }
      if (before.status !== "PENDING")
        throw new ApiError("A cobrança não está pendente; não foi alterada.",409);
      // Official Asaas endpoint exists only in Sandbox. It changes the
      // provider payment status, which can emit a real provider webhook.
      // Never retry automatically after an inconclusive API response.
      await asaas("/sandbox/payment/" + encodeURIComponent(paymentId) + "/confirm",{},"POST");
      const after = await asaas<AsaasCharge>("/payments/" + encodeURIComponent(paymentId));
      const verified = verifiedSandboxRenewalPayment(paymentId,order.provider_subscription_id,after);
      if (!verified || verified.dueDate !== candidates[0].dueDate ||
          verified.amount !== order.amount)
        return Response.json({ok:true,result:"awaiting_confirmation",alreadyPaid:false});
      const result = await applySandboxRenewal(verified);
      return Response.json({ok:true,result,alreadyPaid:false});
    }
    if (action === "generate-next-charge" && typeof id === "string") {
      if (confirmed !== true)
        throw new ApiError("Confirme explicitamente a geração da cobrança de teste.", 400);
      const { data: order, error } = await db.from("nc_billing_orders")
        .select("id,method,status,amount,cycle,environment,provider_subscription_id,sandbox_valid_until")
        .eq("id",id).single();
      if (error || !order || order.environment !== "sandbox" ||
          order.method !== "card" || order.status !== "paid" ||
          !order.provider_subscription_id || !order.sandbox_valid_until ||
          !["monthly","quarterly","yearly"].includes(order.cycle)) {
        throw new ApiError("Pedido recorrente de teste inválido.", 409);
      }
      // Independent provider verification before creating any future charge.
      const subscription = await asaas<{
        id:string; value:number; cycle:string; billingType:string;
        status:string; nextDueDate:string;
      }>("/subscriptions/" + encodeURIComponent(order.provider_subscription_id));
      const cycleMap:Record<string,string> = {monthly:"MONTHLY",quarterly:"QUARTERLY",yearly:"YEARLY"};
      const due = new Intl.DateTimeFormat("en-CA",{
        timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"
      }).format(new Date(order.sandbox_valid_until));
      if (subscription.id !== order.provider_subscription_id ||
          subscription.status !== "ACTIVE" || subscription.billingType !== "CREDIT_CARD" ||
          subscription.cycle !== cycleMap[order.cycle] ||
          Math.round(subscription.value * 100) !== order.amount ||
          subscription.nextDueDate !== due) {
        throw new ApiError("Os dados da assinatura no Asaas não correspondem ao próximo ciclo. Nenhuma cobrança foi gerada.",409);
      }
      const next = Date.parse(due + "T12:00:00Z");
      const now = Date.now();
      if (!Number.isFinite(next) || next < now - 2*86400000 || next > now + 120*86400000)
        throw new ApiError("O próximo vencimento está fora da janela segura de homologação.",409);
      const path = "/subscriptions/" + encodeURIComponent(subscription.id) + "/payments?limit=100";
      const before = await asaas<{data:AsaasCharge[];hasMore?:boolean}>(path);
      if (before.hasMore) throw new ApiError("Há mais cobranças a verificar. Operação bloqueada por segurança.",409);
      if (before.data.some(p => p.dueDate === due)) {
        return Response.json({ok:true,alreadyGenerated:true,dueDate:due});
      }
      await generateSandboxPaymentBook(subscription.id,due);
      const after = await asaas<{data:AsaasCharge[];hasMore?:boolean}>(path);
      const generated = after.data.filter(p =>
        p.subscription === subscription.id && p.dueDate === due &&
        Math.round(p.value*100) === order.amount
      );
      return Response.json({ok:true,alreadyGenerated:false,
        dueDate:due,found:generated.length,
        listedPayments:after.data.length,
        message:generated.length ? "Cobrança futura localizada no Asaas Sandbox." :
          "Geração solicitada ao Asaas; consulte novamente para confirmar a cobrança."});
    }
    if (action === "review-renewal" && typeof id === "string") {
      const { data: order, error } = await db
        .from("nc_billing_orders")
        .select("id,cycle,method,amount,status,provider_subscription_id,sandbox_valid_until")
        .eq("id", id)
        .single();
      if (error || !order || order.status !== "paid" || order.method !== "card" ||
          !order.provider_subscription_id || !order.sandbox_valid_until)
        throw new ApiError("Assinatura vinculada e paga não encontrada.", 404);
      if (!["monthly","quarterly","yearly"].includes(order.cycle))
        throw new ApiError("Período inválido.", 400);
      // Read only; this endpoint never updates a subscription or the simulated access.
      const provider = await asaas<{ data: AsaasCharge[]; hasMore?: boolean }>(
        "/subscriptions/" + encodeURIComponent(order.provider_subscription_id) +
        "/payments?limit=100"
      );
      const candidates = findRenewalCandidates({
        cycle: order.cycle as "monthly" | "quarterly" | "yearly", amount: order.amount,
        provider_subscription_id: order.provider_subscription_id,
        sandbox_valid_until: order.sandbox_valid_until,
      }, provider.data ?? []);
      return Response.json({
        ok: true,
        reviewOnly: true,
        candidates,
        morePages: provider.hasMore === true,
        listedPayments: provider.data?.length ?? 0,
        // Reveal only billing dates and statuses, never customer identity.
        paymentSummary: (provider.data ?? []).slice(0,15).map(p => ({
          dueDate: p.dueDate,
          status: p.status,
          matchesSubscription: p.subscription === order.provider_subscription_id,
          matchesAmount: Number.isFinite(p.value) && Math.round(p.value*100) === order.amount,
        })),
        reason: candidates.length ? "candidates_found" : "no_new_cycle",
      });
    }
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
