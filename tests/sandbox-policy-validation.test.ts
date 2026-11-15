import {test} from "node:test";
import assert from "node:assert/strict";
import {validateSandboxBillingPolicy} from "../lib/sandbox-policy-validation";

test("all 25 proposal policy outcomes pass, including fourth-day cutoff and review cases",()=>{
  const report=validateSandboxBillingPolicy("2027-01-13T14:33:16.605Z");
  assert.equal(report.total,25);
  assert.equal(report.passed,25);
  assert.equal(report.allPassed,true);
  const get=(scenario:string,offset:number)=>report.checks.find(c=>c.scenario===scenario&&c.offset===offset)!;
  assert.equal(get("pending",3).observedState,"grace");
  assert.equal(get("pending",4).observedState,"unpaid");
  assert.equal(get("declined",4).observedState,"unpaid");
  assert.equal(get("canceled",1).observedState,"unpaid");
  assert.equal(get("refunded",1).observedState,"manual_review");
  assert.equal(get("disputed",4).observedState,"manual_review");
});
test("invalid billing baseline fails all checks without extending access",()=>{
  const report=validateSandboxBillingPolicy("bad-date");
  assert.equal(report.passed,0);
  assert.equal(report.allPassed,false);
  assert.ok(report.checks.every(c=>!c.passed&&c.observedState===null));
});
test("dates straddling a year boundary retain every policy outcome",()=>{
  const report=validateSandboxBillingPolicy("2027-12-31T14:00:00.000Z");
  assert.equal(report.passed,25);
});
