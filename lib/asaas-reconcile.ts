import { type BillingCycle } from "./plans";

export type SandboxSubscriptionCandidate = {
  id: string;
  value: number;
  cycle: string;
  billingType: string;
  dateCreated?: string | null;
  nextDueDate?: string | null;
  externalReference?: string | null;
  status?: string | null;
  deleted?: boolean;
};

export type SandboxOrderForMatching = {
  id: string;
  amount: number;
  cycle: BillingCycle;
  method: string;
  status: string;
  created_at: string;
  provider_subscription_id: string | null;
};

/**
 * Fallback for legacy Sandbox checkouts only. The administrator must explicitly
 * choose one candidate; this is not proof of ownership for production billing.
 * Never match an external reference belonging to another order or product.
 */
export function matchesLegacySandboxSubscription(
  order: SandboxOrderForMatching,
  subscription: SandboxSubscriptionCandidate,
): boolean {
  if (order.method !== "card" || order.status !== "paid" ||
      order.provider_subscription_id !== null) return false;
  if (!/^sub_[A-Za-z0-9_-]{6,100}$/.test(subscription.id)) return false;
  if (subscription.externalReference && subscription.externalReference !== order.id) return false;
  if (subscription.deleted || subscription.status !== "ACTIVE") return false;
  if (subscription.billingType !== "CREDIT_CARD") return false;
  const cycle: Record<BillingCycle, string> = {
    monthly: "MONTHLY", quarterly: "QUARTERLY", yearly: "YEARLY",
  };
  if (subscription.cycle !== cycle[order.cycle]) return false;
  if (!Number.isFinite(subscription.value) ||
      Math.round(subscription.value * 100) !== order.amount) return false;
  // Legacy checkout created a subscription on the same calendar day.
  // Allow +/- 1 calendar day for time zone differences only.
  if (!subscription.dateCreated) return false;
  const original = Date.parse(order.created_at);
  const created = Date.parse(subscription.dateCreated + "T12:00:00Z");
  if (!Number.isFinite(original) || !Number.isFinite(created) ||
      Math.abs(created - original) > 36 * 60 * 60 * 1000) return false;
  return true;
}
