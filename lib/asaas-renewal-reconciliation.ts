import type { BillingCycle } from "./plans";
import { addBillingMonths } from "./sandbox-renewal-simulator";

/** A read-only, provider-backed candidate. It NEVER grants or extends access. */
export type AsaasCharge = {
  id: string;
  subscription?: string | null;
  status: string;
  value: number;
  dueDate: string;
};
export type ReconciliationOrder = {
  cycle: BillingCycle;
  amount: number;
  provider_subscription_id: string;
  sandbox_valid_until: string;
};
export type RenewalCandidate = {
  chargeId: string;
  dueDate: string;
  status: string;
  projectedUntil: string | null;
  readyForReview: boolean;
};

const settled = new Set(["CONFIRMED", "RECEIVED"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function utcDate(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * A distinct charge is a *possible* renewal only if its due-date is on or
 * after the stored paid-period end, its subscription and amount match, and
 * the provider explicitly reports it settled. Never infer renewal from
 * SUBSCRIPTION_UPDATED or from a redirect.
 */
export function findRenewalCandidates(
  order: ReconciliationOrder,
  charges: AsaasCharge[],
): RenewalCandidate[] {
  const endDate = utcDate(order.sandbox_valid_until);
  if (!endDate || !/^sub_[A-Za-z0-9_-]{6,100}$/.test(order.provider_subscription_id)) return [];
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[order.cycle];
  if (!months) return [];
  const unique = new Map<string, RenewalCandidate>();
  for (const charge of charges) {
    if (!/^pay_[A-Za-z0-9_-]{3,120}$/.test(charge.id) ||
        charge.subscription !== order.provider_subscription_id ||
        !Number.isFinite(charge.value) ||
        Math.round(charge.value * 100) !== order.amount ||
        !datePattern.test(charge.dueDate)) continue;
    const check = new Date(charge.dueDate + "T00:00:00.000Z");
    if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0,10) !== charge.dueDate) continue;
    if (charge.dueDate < endDate) continue;
    const projected = addBillingMonths(order.sandbox_valid_until, months);
    if (!projected) continue;
    const ready = settled.has(charge.status);
    unique.set(charge.id, {
      chargeId: charge.id, dueDate: charge.dueDate, status: charge.status,
      projectedUntil: ready ? projected : null,
      readyForReview: ready,
    });
  }
  return [...unique.values()].sort((a,b) =>
    a.dueDate.localeCompare(b.dueDate) || a.chargeId.localeCompare(b.chargeId));
}
