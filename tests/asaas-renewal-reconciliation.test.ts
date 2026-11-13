import { test } from "node:test";
import assert from "node:assert/strict";
import { findRenewalCandidates, type AsaasCharge } from "../lib/asaas-renewal-reconciliation";

const order = {
  cycle:"monthly" as const, amount:1490,
  provider_subscription_id:"sub_m5gdy1upm25fbwgx",
  sandbox_valid_until:"2026-12-13T14:30:00.000Z",
};
const charge = (id:string,status:string,dueDate:string,extra:Partial<AsaasCharge>={}):AsaasCharge => ({
  id, status, dueDate, value:14.9, subscription:order.provider_subscription_id, ...extra
});

test("only a settled matching charge for the next paid period is a renewal candidate", () => {
  const result = findRenewalCandidates(order,[
    charge("pay_first","RECEIVED","2026-11-13"),
    charge("pay_second","CONFIRMED","2026-12-13"),
    charge("pay_unpaid","PENDING","2027-01-13")
  ]);
  assert.equal(result.length,2);
  assert.equal(result[0].readyForReview,true);
  assert.equal(result[0].projectedUntil,"2027-01-13T14:30:00.000Z");
  assert.equal(result[1].readyForReview,false);
  assert.equal(result[1].projectedUntil,null);
});

test("rejects different subscriptions, amount or invalid due dates", () => {
  assert.deepEqual(findRenewalCandidates(order,[
    charge("pay_wrongsub","RECEIVED","2026-12-13",{subscription:"sub_other"}),
    charge("pay_wrongamount","RECEIVED","2026-12-13",{value:39.9}),
    charge("pay_bad_date","RECEIVED","2026-02-30"),
    charge("pay_missing","RECEIVED","2026-12-13",{subscription:null}),
  ]),[]);
});

test("duplicate notifications or queries cannot multiply renewal candidates", () => {
  const c=charge("pay_same","RECEIVED","2026-12-13");
  const result=findRenewalCandidates(order,[c,c,c]);
  assert.equal(result.length,1);
});

test("quarterly and yearly periods use their corresponding cycles", () => {
  assert.equal(findRenewalCandidates({...order,cycle:"quarterly"},[charge("pay_quarterly","RECEIVED","2026-12-13")])[0].projectedUntil,
    "2027-03-13T14:30:00.000Z");
  assert.equal(findRenewalCandidates({...order,cycle:"yearly"},[charge("pay_yearly","RECEIVED","2026-12-13")])[0].projectedUntil,
    "2027-12-13T14:30:00.000Z");
});
