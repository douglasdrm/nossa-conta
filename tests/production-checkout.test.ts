import assert from "node:assert/strict";
import test from "node:test";
import {
  productionCheckoutPayload, productionCheckoutUrl, requestProductionCheckout,
} from "../lib/production-checkout";

test("checkout uses catalog totals with recurring card and one-time Pix", () => {
  const pix = productionCheckoutPayload("order-1", "quarterly", "pix", 3990, "fixture");
  const card = productionCheckoutPayload("order-2", "yearly", "card", 11990, "fixture");
  assert.deepEqual(pix.chargeTypes, ["DETACHED"]);
  assert.equal(pix.subscription, undefined);
  assert.equal(pix.items[0].value, 39.9);
  assert.equal(pix.externalReference, "order-1");
  assert.deepEqual(card.chargeTypes, ["RECURRENT"]);
  assert.equal(card.subscription?.cycle, "YEARLY");
  assert.equal(card.items[0].value, 119.9);
  assert.throws(() => productionCheckoutPayload("order-1", "monthly", "pix", 1, "fixture"));
});

test("checkout request targets production and validates the hosted link", async () => {
  const payload = productionCheckoutPayload("order-1", "monthly", "pix", 1490, "fixture");
  const id = await requestProductionCheckout("test-key", payload, async (url, init) => {
    assert.equal(url, "https://api.asaas.com/v3/checkouts");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("access_token"), "test-key");
    return Response.json({ id: "checkout_fixture" });
  });
  assert.equal(productionCheckoutUrl(id), "https://asaas.com/checkoutSession/show?id=checkout_fixture");
  await assert.rejects(requestProductionCheckout("test-key", payload, async () =>
    Response.json({ id: "https://example.test" })), /checkout inválido/);
});
