import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateSandboxRenewal, addBillingMonths } from "../lib/sandbox-renewal-simulator";

const baseline = "2026-12-13T14:30:00.000Z";

test("approved renewal extends exactly one full cycle from stored validity", () => {
  assert.deepEqual([
    simulateSandboxRenewal({cycle:"monthly",baselineValidUntil:baseline,scenario:"approved"})?.projectedValidUntil,
    simulateSandboxRenewal({cycle:"quarterly",baselineValidUntil:baseline,scenario:"approved"})?.projectedValidUntil,
    simulateSandboxRenewal({cycle:"yearly",baselineValidUntil:baseline,scenario:"approved"})?.projectedValidUntil,
  ], [
    "2027-01-13T14:30:00.000Z",
    "2027-03-13T14:30:00.000Z",
    "2027-12-13T14:30:00.000Z",
  ]);
});

test("decline never extends validity; cancel prevents future renewal but keeps paid period", () => {
  const declined=simulateSandboxRenewal({cycle:"monthly",baselineValidUntil:baseline,scenario:"declined"});
  const canceled=simulateSandboxRenewal({cycle:"monthly",baselineValidUntil:baseline,scenario:"canceled"});
  assert.equal(declined?.effect,"preserve");
  assert.equal(declined?.projectedValidUntil,baseline);
  assert.equal(declined?.nextChargeExpected,true);
  assert.equal(canceled?.projectedValidUntil,baseline);
  assert.equal(canceled?.nextChargeExpected,false);
});

test("month-end clamping and leap years", () => {
  assert.equal(addBillingMonths("2026-01-31T16:05:00.000Z",1),"2026-02-28T16:05:00.000Z");
  assert.equal(addBillingMonths("2028-01-31T16:05:00.000Z",1),"2028-02-29T16:05:00.000Z");
  assert.equal(addBillingMonths("2026-01-31T16:05:00.000Z",3),"2026-04-30T16:05:00.000Z");
});

test("invalid dates and cycles fail closed", () => {
  assert.equal(simulateSandboxRenewal({cycle:"monthly",baselineValidUntil:"invalid",scenario:"approved"}),null);
  assert.equal(simulateSandboxRenewal({cycle:"fake" as "monthly",baselineValidUntil:baseline,scenario:"approved"}),null);
  assert.equal(addBillingMonths(baseline,0),null);
});
