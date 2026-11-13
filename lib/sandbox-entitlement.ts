import type { BillingCycle } from "./plans";

export type SandboxOrder = {
  cycle: BillingCycle;
  status: string;
  sandbox_valid_until: string | null;
};

/**
 * Displays a persisted sandbox-only entitlement. This must never be used as
 * an authorization decision for real Premium features.
 */
export function sandboxEntitlementPreview(order: SandboxOrder, now = new Date()) {
  if (order.status !== "paid" || !order.sandbox_valid_until) {
    return { state: "inactive" as const, validUntil: null };
  }
  const validUntil = new Date(order.sandbox_valid_until);
  if (!Number.isFinite(validUntil.getTime())) {
    return { state: "inactive" as const, validUntil: null };
  }
  return {
    state: validUntil > now ? ("active" as const) : ("expired" as const),
    validUntil: validUntil.toISOString(),
  };
}
