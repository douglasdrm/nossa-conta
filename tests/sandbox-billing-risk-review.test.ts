import {test} from "node:test";
import assert from "node:assert/strict";
import {reviewSandboxBillingRisks} from "../lib/sandbox-billing-risk-review";

const order={subscriptionId:"sub_renewal_test12345",amount:1490,validUntil:"2027-01-13T14:33:16.605Z"};
const charge=(id:string,dueDate:string,status:string) => ({
  id,subscription:order.subscriptionId,dueDate,status,value:14.9,
});
const active={id:order.subscriptionId,status:"ACTIVE",nextDueDate:"2027-01-13"};
test("pending next charge does not grant a period",()=>{
  const review=reviewSandboxBillingRisks(order,active,[
    charge("pay_december","2026-12-13","CONFIRMED"),
    charge("pay_january","2027-01-13","PENDING")
  ]);
  assert.equal(review.category,"pending_next_cycle");
  assert.equal(review.nextPaymentStatus,"PENDING");
  assert.equal(review.futureChargesExpected,true);
  assert.equal(review.simulatedValidityUnaffected,true);
});
test("refunded or disputed charge always requires manual review",()=>{
  const review=reviewSandboxBillingRisks(order,active,[
    charge("pay_december","2026-12-13","REFUNDED"),
    charge("pay_january","2027-01-13","PENDING")
  ]);
  assert.equal(review.category,"refund_or_dispute");
  assert.deepEqual(review.reversedPaymentDueDates,["2026-12-13"]);
  assert.equal(review.refundRequiresManualReview,true);
});
test("stopped subscriptions preserve paid period",()=>{
  const review=reviewSandboxBillingRisks(order,{...active,status:"INACTIVE"},[
    charge("pay_december","2026-12-13","CONFIRMED")
  ]);
  assert.equal(review.category,"subscription_stopped");
  assert.equal(review.futureChargesExpected,false);
  assert.equal(review.simulatedValidityUnaffected,true);
});
test("payment failure blocks extension and mismatched charges are ignored",()=>{
  const review=reviewSandboxBillingRisks(order,active,[
    charge("pay_declined","2027-01-13","CREDIT_CARD_CAPTURE_REFUSED"),
    {...charge("pay_other","2026-12-13","REFUNDED"),subscription:"sub_other"},
    {...charge("pay_invalid","2027-01-13","REFUNDED"),value:39.9}
  ]);
  assert.equal(review.category,"payment_problem");
  assert.deepEqual(review.reversedPaymentDueDates,[]);
});
test("unrecognized subscription status asks for manual review",()=>{
  assert.equal(reviewSandboxBillingRisks(order,{...active,status:"UNKNOWN"},[]).category,"review_unknown");
  assert.throws(()=>reviewSandboxBillingRisks(order,{...active,id:"sub_other"},[]));
});
