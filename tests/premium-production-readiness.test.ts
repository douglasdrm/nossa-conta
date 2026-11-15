import {test} from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePremiumProductionReadiness,
  previewShadowPremiumDecision,
  type ProductionReadinessChecks,
} from "../lib/premium-production-readiness";

const pending:ProductionReadinessChecks={
  sandboxRenewalVerified:true,courtesyIsolationPreserved:true,
  productionCheckoutConfigured:false,productionWebhookVerified:false,
  productionPaymentLedger:false,householdEntitlementResolver:false,
  refundDisputeHandling:false,authorizationGatesTested:false,
  explicitLaunchApproved:false,
};
const now="2026-11-15T12:00:00Z";
test("real activation is blocked by default even after successful Sandbox homologation",()=>{
  const report=evaluatePremiumProductionReadiness(pending);
  assert.equal(report.passed,2);
  assert.equal(report.total,9);
  assert.equal(report.ready,false);
  assert.equal(report.realBillingEnabled,false);
  assert.equal(report.realPremiumEnforced,false);
  assert.equal(report.accessPolicy,"free_for_all_unchanged");
});
test("even a complete checklist does not switch on payment or access",()=>{
  const all=Object.fromEntries(Object.keys(pending).map(k=>[k,true])) as ProductionReadinessChecks;
  const report=evaluatePremiumProductionReadiness(all);
  assert.equal(report.ready,true);
  assert.equal(report.realBillingEnabled,false);
  assert.equal(report.realPremiumEnforced,false);
});
test("Sandbox confirmed payment never grants real paid Premium shadow eligibility",()=>{
  const result=previewShadowPremiumDecision({
    now,evidence:{environment:"sandbox",householdMatches:true,providerVerified:true,
      paymentStatus:"CONFIRMED",paidUntil:"2027-01-13T14:00:00Z"}
  });
  assert.deepEqual(result,{
    hypotheticalPaidPeriod:false,courtesyActive:false,requiresManualReview:false,
    realAccessChanged:false,reason:"sandbox_ignored",
  });
});
test("active courtesy remains independent from an unrelated Sandbox payment",()=>{
  const result=previewShadowPremiumDecision({
    now,courtesyValidUntil:"2027-01-02T00:00:00Z",
    evidence:{environment:"sandbox",householdMatches:true,providerVerified:true,
      paymentStatus:"RECEIVED",paidUntil:"2027-01-13T14:00:00Z"}
  });
  assert.equal(result?.courtesyActive,true);
  assert.equal(result?.hypotheticalPaidPeriod,false);
  assert.equal(result?.reason,"courtesy");
  assert.equal(result?.realAccessChanged,false);
});
test("hypothetical production payment requires household match, verified provider, settlement and live period",()=>{
  const evidence={
    environment:"production" as const,householdMatches:true,providerVerified:true,
    paymentStatus:"CONFIRMED" as const,paidUntil:"2027-01-13T14:00:00Z",
  };
  assert.equal(previewShadowPremiumDecision({now,evidence})?.hypotheticalPaidPeriod,true);
  assert.equal(previewShadowPremiumDecision({now,evidence:{...evidence,householdMatches:false}})?.hypotheticalPaidPeriod,false);
  assert.equal(previewShadowPremiumDecision({now,evidence:{...evidence,providerVerified:false}})?.hypotheticalPaidPeriod,false);
  assert.equal(previewShadowPremiumDecision({now,evidence:{...evidence,paymentStatus:"PENDING"}})?.hypotheticalPaidPeriod,false);
  assert.equal(previewShadowPremiumDecision({now,evidence:{...evidence,paidUntil:"2026-11-01T00:00:00Z"}})?.hypotheticalPaidPeriod,false);
});
test("refunds and disputes force review; courtesies are not revoked",()=>{
  for(const paymentStatus of ["REFUNDED","CHARGEBACK_REQUESTED"] as const) {
    const result=previewShadowPremiumDecision({
      now,courtesyValidUntil:"2027-01-13T14:00:00Z",
      evidence:{environment:"production",householdMatches:true,providerVerified:true,
        paymentStatus,paidUntil:"2027-01-13T14:00:00Z"}
    });
    assert.equal(result?.requiresManualReview,true);
    assert.equal(result?.hypotheticalPaidPeriod,false);
    assert.equal(result?.courtesyActive,true);
    assert.equal(result?.realAccessChanged,false);
  }
});
test("invalid reference date fails closed",()=>{
  assert.equal(previewShadowPremiumDecision({now:"not-a-date"}),null);
});
