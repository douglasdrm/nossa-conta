import { z } from "zod";
import { billingCycles } from "./plans";
import { confirmationOrder, verifyInitialCheckoutPayment } from "./production-checkout-confirmation";

const payId = z.string().regex(/^pay_[A-Za-z0-9_-]{3,120}$/);
const subscriptionId = z.string().regex(/^sub_[A-Za-z0-9_-]{6,100}$/);
const payment = z.object({
  id: payId, status: z.string(), billingType: z.string(), value: z.number().positive().finite(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  subscription: subscriptionId.nullish(),
  checkoutSession: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/).nullish(),
  externalReference: z.string().max(250).nullish(),
});
const claim = z.object({
  result: z.literal("claimed"), event_id: z.string(), event_type: z.string(),
  payment_id: payId, attempts: z.number().int().positive(),
});
const context = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lease_lost") }),
  z.object({ kind: z.literal("known") }),
  z.object({ kind: z.literal("unmatched") }),
  z.object({ kind: z.literal("renewal"), cycle: z.enum(billingCycles) }),
  confirmationOrder.extend({ kind: z.literal("initial"), order_id: z.string().uuid() }),
]);

type WorkerStore = {
  claim(): Promise<unknown>;
  context(event: string, attempt: number, checkout: string | null, reference: string | null, subscription: string | null): Promise<unknown>;
  finish(event: string, attempt: number, decision: string, evidence: object | null): Promise<string>;
};

const reversalStatuses = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "CHARGEBACK_REQUESTED"]);
const reversalEvents = new Set(["PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED"]);
const cycles = { monthly: "MONTHLY", quarterly: "QUARTERLY", yearly: "YEARLY" } as const;
const money = (value: number) => {
  const cents = Math.round(value * 100);
  if (cents < 1 || cents > 2_147_483_647 || Math.abs(value * 100 - cents) >= 0.000001)
    throw new Error("Unsupported payment amount");
  return cents;
};

export async function processProductionPayment(store: WorkerStore, key: string, send: typeof fetch = fetch) {
  const entry = await store.claim();
  const idle = z.object({ result: z.enum(["empty", "production_disabled", "production_inbox_disabled"]) }).safeParse(entry);
  if (idle.success) return idle.data.result;
  const job = claim.parse(entry);
  const finish = (decision: string, evidence: object | null = null) =>
    store.finish(job.event_id, job.attempts, decision, evidence);

  async function get(path: string) {
    const response = await send("https://api.asaas.com/v3" + path, {
      headers: { access_token: key, "User-Agent": "NossaConta/1.0" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Provider lookup failed");
    return response.json();
  }

  let decision: string;
  let evidence: object | null = null;
  try {
    const row = payment.parse(await get("/payments/" + job.payment_id));
    if (row.id !== job.payment_id) return finish("manual_review");
    const providerDate = new Date(row.dueDate + "T00:00:00Z");
    if (!Number.isFinite(providerDate.valueOf()) || providerDate.toISOString().slice(0, 10) !== row.dueDate)
      return finish("manual_review");

    const base = {
      paymentId: row.id, subscriptionId: row.subscription ?? null, amountCents: money(row.value),
      dueDate: row.dueDate, status: row.status,
    };
    const match = context.parse(await store.context(
      job.event_id, job.attempts, row.checkoutSession ?? null, row.externalReference ?? null, base.subscriptionId,
    ));
    if (match.kind === "lease_lost") return "not_leased";

    if (reversalStatuses.has(row.status)) {
      decision = match.kind === "known" ? "apply" : "manual_review";
      if (decision === "apply") evidence = { ...base, kind: "reversal" };
    } else if (reversalEvents.has(job.event_type)) {
      // A reversal notification may arrive before the API reflects its new status.
      decision = "retry";
    } else if (!["CONFIRMED", "RECEIVED"].includes(row.status)) {
      decision = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(job.event_type) ? "retry" : "processed";
    } else if (match.kind === "known") {
      decision = "processed";
    } else if (match.kind === "initial") {
      const checked = await verifyInitialCheckoutPayment(key, match, send);
      if (checked.status === "verified" && checked.paymentId === row.id) {
        decision = "apply";
        evidence = {
          ...base, status: checked.providerStatus, subscriptionId: checked.subscriptionId, dueDate: checked.dueDate,
          kind: "initial", orderId: match.order_id, checkoutId: match.checkout_id,
        };
      } else {
        decision = checked.status === "pending" ? "retry" : "manual_review";
      }
    } else if (match.kind === "renewal" && row.billingType === "CREDIT_CARD" && row.subscription) {
      const sub = z.object({ id: subscriptionId, cycle: z.string() }).parse(await get("/subscriptions/" + row.subscription));
      if (sub.id !== row.subscription || sub.cycle !== cycles[match.cycle]) {
        decision = "manual_review";
      } else {
        decision = "apply";
        evidence = { ...base, kind: "renewal", cycle: match.cycle };
      }
    } else {
      decision = "retry";
    }
  } catch {
    decision = "retry";
  }
  return finish(decision, evidence);
}
