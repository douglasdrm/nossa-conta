import { z } from "zod";
import { billingCycles } from "./plans";

const checkoutId = z.string().regex(/^[A-Za-z0-9_-]{10,100}$/);
const paymentId = z.string().regex(/^pay_[A-Za-z0-9_-]{3,120}$/);
const subscriptionId = z.string().regex(/^sub_[A-Za-z0-9_-]{6,100}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((raw) => {
  const parsed = new Date(raw + "T00:00:00Z");
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === raw;
});
const money = z.number().finite().positive();
const payment = z.object({
  id: paymentId, checkoutSession: checkoutId.nullish(), subscription: subscriptionId.nullish(),
  value: money, dueDate: date, status: z.string(), billingType: z.string(),
});
export const confirmationOrder = z.object({
  checkout_id: checkoutId, payment_id: paymentId.nullable(),
  amount_cents: z.number().int().positive(), method: z.enum(["pix", "card"]), cycle: z.enum(billingCycles),
});
type Order = z.infer<typeof confirmationOrder>;

function matchesAmount(value: number, cents: number) {
  return Math.abs(value * 100 - cents) < 0.000001;
}

export async function verifyInitialCheckoutPayment(key: string, order: Order, send: typeof fetch = fetch) {
  async function get(path: string) {
    const response = await send("https://api.asaas.com/v3" + path, {
      headers: { access_token: key, "User-Agent": "NossaConta/1.0" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Consulta de pagamento indisponível.");
    return response.json();
  }

  const query = new URLSearchParams({ checkoutSession: order.checkout_id, limit: "20" });
  const records = z.object({ data: z.array(payment), hasMore: z.boolean() }).parse(await get("/payments?" + query));
  if (records.hasMore) return { status: "manual_review" } as const;
  const candidates = records.data.filter((row) => order.payment_id
    ? row.id === order.payment_id
    : row.status === "RECEIVED" || (order.method === "card" && row.status === "CONFIRMED"));
  if (candidates.length === 0) return { status: "pending" } as const;
  if (candidates.length !== 1) return { status: "manual_review" } as const;
  const row = candidates[0];
  const compatible = order.method === "pix"
    ? row.billingType === "PIX" && row.status === "RECEIVED" && !row.subscription
    : row.billingType === "CREDIT_CARD" && ["RECEIVED", "CONFIRMED"].includes(row.status) && !!row.subscription;
  if (!compatible || !matchesAmount(row.value, order.amount_cents) ||
    (row.checkoutSession && row.checkoutSession !== order.checkout_id)) {
    return { status: "manual_review" } as const;
  }

  if (order.method === "card" && !order.payment_id) {
    const subscription = z.object({
      id: subscriptionId, cycle: z.string(), value: money, status: z.string(), billingType: z.string(),
    }).parse(await get("/subscriptions/" + row.subscription));
    const cycle = { monthly: "MONTHLY", quarterly: "QUARTERLY", yearly: "YEARLY" }[order.cycle];
    if (subscription.id !== row.subscription || subscription.cycle !== cycle ||
      subscription.status !== "ACTIVE" || subscription.billingType !== "CREDIT_CARD" ||
      !matchesAmount(subscription.value, order.amount_cents)) {
      return { status: "manual_review" } as const;
    }
  }

  return {
    status: "verified", paymentId: row.id, subscriptionId: row.subscription ?? null,
    dueDate: row.dueDate, providerStatus: row.status,
  } as const;
}
