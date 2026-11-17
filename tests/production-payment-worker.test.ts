import assert from "node:assert/strict";
import test from "node:test";
import { processProductionPayment } from "../lib/production-payment-worker";

const event = { result: "claimed", event_id: "evt_worker", event_type: "PAYMENT_RECEIVED", payment_id: "pay_fixture", attempts: 1 };
const pix = { id: event.payment_id, value: 14.9, status: "RECEIVED", billingType: "PIX", checkoutSession: "checkout_fixture", dueDate: "2026-11-16" };

function store(context: object, entry = event) {
  const calls: unknown[][] = [];
  return {
    calls,
    claim: async () => entry,
    context: async (...args: unknown[]) => { calls.push(args); return context; },
    finish: async (...args: unknown[]) => { calls.push(args); return String(args[2]); },
  };
}

test("worker verifies the initial charge by checkout before applying it", async () => {
  const db = store({
    kind: "initial", checkout_id: pix.checkoutSession, payment_id: null,
    amount_cents: 1490, method: "pix", cycle: "monthly", order_id: "10000000-0000-4000-8000-000000000001",
  });
  const visited: string[] = [];
  const result = await processProductionPayment(db, "fixture", async (input) => {
    const url = new URL(String(input));
    visited.push(url.pathname);
    assert.equal(url.origin, "https://api.asaas.com");
    return Response.json(url.pathname === "/v3/payments"
      ? { data: [pix], hasMore: false } : pix);
  });
  assert.equal(result, "apply");
  assert.deepEqual(visited, ["/v3/payments/pay_fixture", "/v3/payments"]);
  assert.deepEqual(db.calls[1].slice(0, 3), [event.event_id, 1, "apply"]);
  assert.equal((db.calls[1][3] as { kind: string }).kind, "initial");
});

test("worker retries when a payment notification precedes provider confirmation", async () => {
  const db = store({ kind: "known" }, { ...event, event_type: "PAYMENT_REFUNDED" });
  assert.equal(await processProductionPayment(db, "fixture", async () => Response.json(pix)), "retry");
  assert.deepEqual(db.calls[1], [event.event_id, 1, "retry", null]);
});

test("worker verifies the subscription cycle on a renewal", async () => {
  const db = store({ kind: "renewal", cycle: "monthly" });
  const card = { ...pix, billingType: "CREDIT_CARD", subscription: "sub_fixture01" };
  const result = await processProductionPayment(db, "fixture", async (input) => Response.json(
    new URL(String(input)).pathname === "/v3/subscriptions/sub_fixture01"
      ? { id: card.subscription, cycle: "YEARLY" } : card,
  ));
  assert.equal(result, "manual_review");
});

test("worker never contacts the provider with processing disabled", async () => {
  const db = { ...store({ kind: "unmatched" }), claim: async () => ({ result: "production_disabled" }) };
  const result = await processProductionPayment(db, "fixture", async () => assert.fail("called Asaas"));
  assert.equal(result, "production_disabled");
});
