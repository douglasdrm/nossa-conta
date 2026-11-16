import {test} from "node:test";
import assert from "node:assert/strict";
import {
  previewProductionPaymentReconciliation as review,
  previewHouseholdPremiumRights as rights,
  type ExpectedProductionCharge,
  type VerifiedProviderCharge,
} from "../lib/production-reconciliation-preview";

const expected:ExpectedProductionCharge={
  householdId:"family_A",subscriptionId:"sub_verified_01234",amountCents:1490,
  dueDate:"2027-01-13",cycle:"monthly",
};
const provider:VerifiedProviderCharge={
  id:"pay_verified_12345",environment:"production",householdReference:"family_A",
  subscriptionId:"sub_verified_01234",amountCents:1490,dueDate:"2027-01-13",
  cycle:"monthly",status:"CONFIRMED",fetchedFromProvider:true,
};
test("fully matched verified payment is only eligible, never applied in dry run",()=>{
  assert.deepEqual(review(expected,provider,[]),{
    outcome:"eligible",reason:"eligible_for_future_server_only_processing",
    wouldWrite:false,wouldGrantAccess:false,
  });
});
test("duplicate payment identifier cannot renew twice",()=>{
  assert.equal(review(expected,provider,[provider.id]).outcome,"duplicate");
});
test("reject unverified Sandbox and mismatched household, amount, subscription, cycle or date",()=>{
  const variants=[
    {...provider,fetchedFromProvider:false},
    {...provider,environment:"sandbox" as const},
    {...provider,householdReference:"family_B"},
    {...provider,subscriptionId:"sub_other_123456"},
    {...provider,amountCents:3990},
    {...provider,cycle:"yearly"},
    {...provider,dueDate:"2027-02-13"},
    {...provider,id:"not-a-payment"},
  ];
  for (const variant of variants) {
    const result=review(expected,variant,[]);
    assert.equal(result.outcome,"rejected",result.reason);
    assert.equal(result.wouldGrantAccess,false);
    assert.equal(result.wouldWrite,false);
  }
});
test("pending, refused and overdue charges are never eligible",()=>{
  for (const status of ["PENDING","OVERDUE","CANCELED","CREDIT_CARD_CAPTURE_REFUSED"] as const) {
    assert.equal(review(expected,{...provider,status},[]).outcome,"rejected");
  }
});
test("refunds and disputes are sent to human review without revocation",()=>{
  for (const status of ["REFUNDED","PARTIALLY_REFUNDED","CHARGEBACK_REQUESTED"] as const) {
    const r=review(expected,{...provider,status},[]);
    assert.equal(r.outcome,"manual_review");
    assert.equal(r.wouldGrantAccess,false);
  }
});
const baseline={
  householdId:"family_A",now:"2026-11-16T12:00:00Z",
  courtesyUntil:null as string|null,
  paidThrough:"2027-01-13T14:00:00Z",
  paymentHouseholdId:"family_A" as string|null,
  paymentVerified:true,
  paymentStatus:"CONFIRMED" as const,
};
test("verified paid evidence belongs only to the matched household",()=>{
  assert.equal(rights(baseline)?.hypotheticalTier,"paid");
  assert.equal(rights({...baseline,householdId:"family_B"})?.hypotheticalTier,"free");
  assert.equal(rights({...baseline,paymentVerified:false})?.hypotheticalTier,"free");
  assert.equal(rights({...baseline,paidThrough:"2026-01-01T00:00:00Z"})?.hypotheticalTier,"free");
  assert.equal(rights({...baseline,paymentStatus:"PENDING"})?.hypotheticalTier,"free");
  assert.equal(rights(baseline)?.actualAccess,"unchanged_free_for_all");
});
test("active courtesy is independent of payments and is never revoked",()=>{
  const r=rights({...baseline,courtesyUntil:"2027-01-15T00:00:00Z",
    paymentStatus:"REFUNDED"});
  assert.equal(r?.hypotheticalTier,"courtesy");
  assert.equal(r?.courtesyActive,true);
  assert.equal(r?.paidEvidenceAccepted,false);
  assert.equal(r?.actualAccess,"unchanged_free_for_all");
});
test("reversed charge without courtesy is escalated; sandbox cannot be interpreted as verified production data",()=>{
  assert.equal(rights({...baseline,paymentStatus:"CHARGEBACK_REQUESTED"})?.hypotheticalTier,"manual_review");
  assert.equal(review(expected,{...provider,environment:"sandbox"},[]).outcome,"rejected");
});
