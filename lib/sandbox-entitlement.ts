import type { BillingCycle } from "./plans";

export type SandboxOrder = {
  cycle: BillingCycle;
  status: string;
  created_at: string;
  updated_at: string;
};

function addMonthsClamped(iso: string, months: number): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.getUTCDate();
  const result = new Date(date);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const finalDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, finalDay));
  return result.toISOString();
}

/**
 * Sandbox-only entitlement preview. Never use this result to authorize
 * Premium features or change a real subscription. Existing orders have no
 * paid_at field, so updated_at is the best available payment timestamp.
 */
export function sandboxEntitlementPreview(order: SandboxOrder, now = new Date()) {
  if (order.status !== "paid") return { state: "inactive" as const, validUntil: null };
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[order.cycle];
  if (!months) return { state: "inactive" as const, validUntil: null };
  const validUntil = addMonthsClamped(order.updated_at, months);
  if (!validUntil) return { state: "inactive" as const, validUntil: null };
  return {
    state: new Date(validUntil) > now ? ("active" as const) : ("expired" as const),
    validUntil,
  };
}
