/**
 * Admin-only Sandbox lifecycle review. This never grants, extends, or removes
 * Premium access. Webhooks may be delivered more than once or out of order.
 */
export type SandboxLifecycleEvent = {
  id: string;
  order_id: string;
  resource_type: string;
  resource_id: string;
  event_type: string;
  created_at: string;
};

export type SandboxLifecycleState =
  | "awaiting_events" | "payment_observed" | "payment_pending"
  | "payment_problem" | "refund_or_dispute" | "subscription_stopped";

const successful = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);
const pending = new Set(["PAYMENT_CREATED"]);
const paymentProblems = new Set(["PAYMENT_OVERDUE", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"]);
const reversals = new Set([
  "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED"
]);
const stopped = new Set(["SUBSCRIPTION_INACTIVATED", "SUBSCRIPTION_DELETED"]);

export function summarizeSandboxLifecycle(events: SandboxLifecycleEvent[]): {
  state: SandboxLifecycleState;
  successfulCharges: number;
  pendingCharges: number;
  problemCharges: number;
  lastEvent: string | null;
} {
  const sorted = [...new Map(events.map(e => [e.id, e])).values()].sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const byResource = new Map<string, SandboxLifecycleEvent>();
  // The latest *received* state for each charge is useful operationally but
  // must not be used to authorize access (provider event ordering can differ).
  for (const e of sorted) byResource.set(e.resource_type + ":" + e.resource_id, e);
  const last = sorted.at(-1) ?? null;
  const statuses = [...byResource.values()];
  const successfulCharges = statuses.filter(e => successful.has(e.event_type)).length;
  const pendingCharges = statuses.filter(e => pending.has(e.event_type)).length;
  const problemCharges = statuses.filter(e => paymentProblems.has(e.event_type)).length;
  const subscriptionStopped = statuses.some(e => e.resource_type === "subscription" && stopped.has(e.event_type));
  const refundOrDispute = statuses.some(e => reversals.has(e.event_type));
  const state: SandboxLifecycleState =
    subscriptionStopped ? "subscription_stopped" :
    refundOrDispute ? "refund_or_dispute" :
    problemCharges ? "payment_problem" :
    pendingCharges ? "payment_pending" :
    successfulCharges ? "payment_observed" : "awaiting_events";
  return { state, successfulCharges, pendingCharges, problemCharges, lastEvent: last?.event_type ?? null };
}
