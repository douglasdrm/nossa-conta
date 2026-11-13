import { test } from "node:test";
import assert from "node:assert/strict";
import { findRenewalCandidates } from "../lib/asaas-renewal-reconciliation";
import { verifiedSandboxRenewalPayment } from "../lib/asaas-renewal-verification";

const order = {
  cycle: "monthly" as const,
  amount: 1490,
  provider_subscription_id: "sub_renewal_test12345",
  sandbox_valid_until: "2026-12-13T14:30:00.000Z",
};

test("only December's pending charge is selected for Sandbox confirmation", () => {
  const charges = [
    {id:"pay_november123",subscription:order.provider_subscription_id,value:14.9,dueDate:"2026-11-13",status:"CONFIRMED"},
    {id:"pay_december123",subscription:order.provider_subscription_id,value:14.9,dueDate:"2026-12-13",status:"PENDING"},
    {id:"pay_january123",subscription:order.provider_subscription_id,value:14.9,dueDate:"2027-01-13",status:"PENDING"},
  ];
  const candidates = findRenewalCandidates(order,charges);
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].chargeId,"pay_december123");
  assert.equal(candidates[0].status,"PENDING");
  assert.equal(candidates[0].readyForReview,false);
  assert.equal(verifiedSandboxRenewalPayment("pay_december123",order.provider_subscription_id,charges[1]),null);
  assert.equal(verifiedSandboxRenewalPayment("pay_december123",order.provider_subscription_id,
    {...charges[1],status:"CONFIRMED"})?.amount,1490);
});
test("wrong subscription or value is never an eligible Sandbox renewal", () => {
  const bad = [
    {id:"pay_wrong1234",subscription:"sub_other_test12345",value:14.9,dueDate:"2026-12-13",status:"PENDING"},
    {id:"pay_mismatch123",subscription:order.provider_subscription_id,value:39.9,dueDate:"2026-12-13",status:"PENDING"},
  ];
  assert.deepEqual(findRenewalCandidates(order,bad),[]);
});
