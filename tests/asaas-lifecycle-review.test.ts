import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeSandboxLifecycle, type SandboxLifecycleEvent } from "../lib/asaas-lifecycle-review";

const make = (id: string, resource: string, type: string, time: string): SandboxLifecycleEvent => ({
  id, order_id:"order-one", resource_type:"payment", resource_id:resource,
  event_type:type, created_at:time,
});

test("no events means awaiting provider confirmation", () => {
  const status = summarizeSandboxLifecycle([]);
  assert.equal(status.state,"awaiting_events");
  assert.equal(status.successfulCharges,0);
});
test("same charge transitions from pending to paid without double counting", () => {
  const status = summarizeSandboxLifecycle([
    make("evt_1","pay_1","PAYMENT_CREATED","2026-11-13T12:00:00Z"),
    make("evt_2","pay_1","PAYMENT_CONFIRMED","2026-11-13T12:10:00Z"),
    make("evt_3","pay_1","PAYMENT_RECEIVED","2026-11-13T12:15:00Z"),
  ]);
  assert.equal(status.successfulCharges,1);
  assert.equal(status.pendingCharges,0);
  assert.equal(status.state,"payment_observed");
});
test("overdue charges and refunds are not treated as successful payments", () => {
  const status = summarizeSandboxLifecycle([
    make("evt_a","pay_1","PAYMENT_RECEIVED","2026-11-13T12:00:00Z"),
    make("evt_b","pay_1","PAYMENT_REFUNDED","2026-11-13T13:00:00Z"),
    make("evt_c","pay_2","PAYMENT_OVERDUE","2026-12-13T13:00:00Z"),
  ]);
  assert.equal(status.successfulCharges,0);
  assert.equal(status.problemCharges,1);
  assert.equal(status.state,"refund_or_dispute");
});
test("inactivated subscription requires review, without revoking paid period", () => {
  const status = summarizeSandboxLifecycle([
    make("evt_1","pay_1","PAYMENT_RECEIVED","2026-11-13T12:00:00Z"),
    { ...make("evt_2","sub_123456","SUBSCRIPTION_INACTIVATED","2026-11-13T13:00:00Z"),resource_type:"subscription" },
  ]);
  assert.equal(status.state,"subscription_stopped");
});
