import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesLegacySandboxSubscription } from "../lib/asaas-reconcile";

const order = {
  id: "dbf87640-5745-47b1-84a8-d92e7e54d001", amount: 1490,
  cycle: "monthly" as const, method: "card",
  status: "paid", created_at: "2026-11-13T14:30:34.000Z",
  provider_subscription_id: null,
};
const subscription = {
  id: "sub_m5gdy1upm25fbwgx", value: 14.9, cycle: "MONTHLY",
  billingType: "CREDIT_CARD", dateCreated: "2026-11-13",
  nextDueDate: "2026-12-13", status: "ACTIVE", deleted: false,
  externalReference: null,
};

test("manual sandbox reconciliation allows a precise legacy candidate", () => {
  assert.equal(matchesLegacySandboxSubscription(order, subscription), true);
  assert.equal(matchesLegacySandboxSubscription(order, {...subscription, externalReference: order.id}), true);
});

test("never links a different plan, checkout, account or previously linked order", () => {
  assert.equal(matchesLegacySandboxSubscription(order, {...subscription, value: 39.9}), false);
  assert.equal(matchesLegacySandboxSubscription(order, {...subscription, cycle: "YEARLY"}), false);
  assert.equal(matchesLegacySandboxSubscription(order, {...subscription, externalReference: "another-order"}), false);
  assert.equal(matchesLegacySandboxSubscription(order, {...subscription, billingType: "PIX"}), false);
  assert.equal(matchesLegacySandboxSubscription(order, {...subscription, dateCreated: "2026-10-01"}), false);
  assert.equal(matchesLegacySandboxSubscription(order, {...subscription, status: "INACTIVE"}), false);
  assert.equal(matchesLegacySandboxSubscription(order, {...subscription, deleted: true}), false);
  assert.equal(matchesLegacySandboxSubscription({...order, status: "pending"}, subscription), false);
  assert.equal(matchesLegacySandboxSubscription({...order, method: "pix"}, subscription), false);
  assert.equal(matchesLegacySandboxSubscription({...order, provider_subscription_id:"sub_other"}, subscription), false);
});
