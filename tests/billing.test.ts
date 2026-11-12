import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkoutPayload,
  checkoutSchema,
  checkoutUrl,
  sandboxConfig,
  verifiedCheckoutStatus,
} from "../lib/asaas";
import { plans } from "../lib/plans";
test("server catalog controls totals and recurrent intervals; Pix never auto-renews", () => {
  for (const plan of plans) {
    const card = checkoutPayload(
      "order",
      plan.id,
      "card",
      "image",
      new Date("2026-11-12T01:00:00Z"),
    );
    assert.equal(card.items[0].value, plan.total / 100);
    assert.deepEqual(card.chargeTypes, ["RECURRENT"]);
    assert.equal(
      card.subscription?.cycle,
      { monthly: "MONTHLY", quarterly: "QUARTERLY", yearly: "YEARLY" }[plan.id],
    );
    assert.equal(card.subscription?.nextDueDate, "2026-11-11");
    const pix = checkoutPayload("order", plan.id, "pix", "image");
    assert.equal(pix.subscription, undefined);
    assert.deepEqual(pix.chargeTypes, ["DETACHED"]);
    assert.equal(
      new URL(card.callback.successUrl).host,
      "nossaconta.unodev.com.br",
    );
  }
  assert.equal(
    checkoutSchema.safeParse({ cycle: "yearly", method: "card", amount: 1 })
      .success,
    false,
  );
});
test("provider result must match reference, amount and known status", () => {
  const c = {
    id: "checkout-id",
    status: "PAID",
    externalReference: "order",
    items: [{ value: 119.9, quantity: 1 }],
  };
  assert.equal(verifiedCheckoutStatus(c, "order", 11990), "paid");
  assert.throws(() => verifiedCheckoutStatus(c, "someone-else", 11990));
  assert.throws(() => verifiedCheckoutStatus(c, "order", 1490));
  assert.throws(() =>
    verifiedCheckoutStatus({ ...c, status: "UNKNOWN" }, "order", 11990),
  );
  assert.throws(() => checkoutUrl("https://evil.test"));
  assert.ok(
    checkoutUrl("131ca662-56c8-4479-b5b3-fd61a413fce7").startsWith(
      "https://sandbox.asaas.com/",
    ),
  );
});
test("live API access fails closed", () => {
  const saved = process.env.ASAAS_ENVIRONMENT;
  process.env.ASAAS_ENVIRONMENT = "production";
  try {
    assert.throws(() => sandboxConfig());
  } finally {
    if (saved === undefined) delete process.env.ASAAS_ENVIRONMENT;
    else process.env.ASAAS_ENVIRONMENT = saved;
  }
});
