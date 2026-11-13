import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateSandboxBillingPolicy as simulate } from "../lib/sandbox-billing-policy";

const validUntil = "2027-01-13T14:33:16.605Z";
const run = (scenario: "pending"|"declined"|"canceled"|"refunded"|"disputed", dayOffset:number) =>
  simulate({validUntil,scenario,dayOffset})!;

test("pending and declined billing preserve paid period until expiry",()=>{
  for(const scenario of ["pending","declined"] as const) {
    assert.equal(run(scenario,-1).state,"paid_period");
    assert.equal(run(scenario,0).state,"paid_period");
    assert.equal(run(scenario,1).state,"grace");
    assert.equal(run(scenario,3).state,"grace");
    assert.equal(run(scenario,4).state,"unpaid");
    assert.equal(run(scenario,4).newPeriodGranted,false);
    assert.equal(run(scenario,4).realPremiumAffected,false);
    assert.equal(run(scenario,1).graceThrough,"2027-01-16");
  }
});
test("cancellation preserves paid days and never grants grace or bills again",()=>{
  assert.equal(run("canceled",-1).state,"paid_period");
  assert.equal(run("canceled",1).state,"unpaid");
  assert.equal(run("canceled",1).futureAutomaticRenewals,false);
  assert.equal(run("canceled",1).shouldAttemptCollection,false);
});
test("refunds and disputes route to review without automatic revocation",()=>{
  for (const scenario of ["refunded","disputed"] as const) {
    const result=run(scenario,1);
    assert.equal(result.state,"manual_review");
    assert.equal(result.manualReviewRequired,true);
    assert.equal(result.realPremiumAffected,false);
    assert.equal(result.newPeriodGranted,false);
    assert.equal(result.futureAutomaticRenewals,false);
  }
});
test("invalid dates, offsets and scenarios fail closed",()=>{
  assert.equal(simulate({validUntil:"not-a-date",scenario:"pending",dayOffset:1}),null);
  assert.equal(simulate({validUntil,scenario:"pending",dayOffset:1.5}),null);
  assert.equal(simulate({validUntil,scenario:"pending",dayOffset:900}),null);
  assert.equal(simulate({validUntil,scenario:"unknown" as "pending",dayOffset:1}),null);
});
test("grace spans calendar-month and calendar-year boundaries",()=>{
  const result=simulate({validUntil:"2027-12-31T14:00:00.000Z",scenario:"declined",dayOffset:3});
  assert.equal(result?.graceThrough,"2028-01-03");
  assert.equal(result?.state,"grace");
});
