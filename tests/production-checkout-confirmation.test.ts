import assert from "node:assert/strict";
import test from "node:test";
import { verifyInitialCheckoutPayment } from "../lib/production-checkout-confirmation";

const order = { checkout_id: "checkout_fixture", payment_id: null, amount_cents: 1490, method: "pix", cycle: "monthly" } as const;
const pix = { id: "pay_fixture", value: 14.9, dueDate: "2026-11-16", status: "RECEIVED", billingType: "PIX", checkoutSession: order.checkout_id };

test("reconciles only a settled Pix charge from the provider's checkout filter", async () => {
  const result = await verifyInitialCheckoutPayment("fixture", order, async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://api.asaas.com/v3/payments");
    assert.equal(url.searchParams.get("checkoutSession"), order.checkout_id);
    return Response.json({ data: [pix], hasMore: false });
  });
  assert.equal(result.status, "verified");

  for (const [data, expected] of [
    [[{ ...pix, status: "PENDING" }], "pending"],
    [[{ ...pix, value: 13 }], "manual_review"],
    [[{ ...pix, checkoutSession: "checkout_other" }], "manual_review"],
    [[pix, { ...pix, id: "pay_extra" }], "manual_review"],
  ] as const) {
    const result = await verifyInitialCheckoutPayment("fixture", order, async () =>
      Response.json({ data, hasMore: false }));
    assert.equal(result.status, expected);
  }
});

test("card checkout validates the underlying subscription cycle", async () => {
  const subscription = "sub_fixture01";
  for (const [cycle, expected] of [["MONTHLY", "verified"], ["YEARLY", "manual_review"]]) {
    const result = await verifyInitialCheckoutPayment("fixture", { ...order, method: "card" }, async (input) => {
      if (new URL(String(input)).pathname === "/v3/subscriptions/" + subscription)
        return Response.json({ id: subscription, cycle, value: 14.9, status: "ACTIVE", billingType: "CREDIT_CARD" });
      return Response.json({
        data: [{ ...pix, subscription, status: "CONFIRMED", billingType: "CREDIT_CARD" }],
        hasMore: false,
      });
    });
    assert.equal(result.status, expected);
  }
});
