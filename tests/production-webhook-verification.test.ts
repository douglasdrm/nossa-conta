import {test} from "node:test";
import assert from "node:assert/strict";
import {
  inspectProductionWebhookAgainstProvider as inspect,
} from "../lib/production-webhook-verification";
import {matchesProductionWebhookToken as token} from "../lib/production-webhook-auth";

const expected={householdId:"family_abc123",subscriptionId:"sub_verified_123456",
  amountCents:1490,dueDate:"2027-01-13",cycle:"monthly" as const};
const event={id:"evt_asaas_123456",event:"PAYMENT_CONFIRMED",
  payment:{id:"pay_verified_123456",status:"CONFIRMED",value:99,externalReference:"forged"}};
const provider={id:"pay_verified_123456",subscription:"sub_verified_123456",
  externalReference:"family_abc123",value:14.9,dueDate:"2027-01-13",status:"CONFIRMED"};
const run=(e:unknown=event,p:unknown=provider,authenticated=true)=>
  inspect(e,p,expected,authenticated);
test("webhook token must be separately configured and uses constant-time comparison",()=>{
  const secret="ThisIsASeparateWebhookSecretThatIsLongEnough2026";
  assert.equal(token(secret,secret),true);
  assert.equal(token(secret,secret+"x"),false);
  assert.equal(token(secret,"DifferentWebhookSecret123456789012345678901"),false);
  assert.equal(token(secret,null),false);
  assert.equal(token(undefined,secret),false);
  assert.equal(token("short", "short"),false);
  assert.equal(token(secret+" ",secret+" "),false);
});
test("matched provider GET gives advisory eligibility only; webhook fields are never trusted",()=>{
  const r=run();
  assert.deepEqual(r,{
    accepted:true,category:"settled",reason:"verified_settlement_candidate",
    eventId:event.id,paymentId:provider.id,writesPerformed:false,premiumGranted:false,
  });
});
test("unauthenticated or invalid webhook is rejected without provider reliance",()=>{
  assert.equal(run(event,provider,false).reason,"webhook_authentication_failed");
  assert.equal(run({event:"PAYMENT_CONFIRMED",payment:{id:provider.id}},provider).reason,
    "webhook_schema_invalid");
  assert.equal(run({...event,event:"UNEXPECTED_PAYMENT_STATUS"},provider).category,"unsupported");
});
test("provider GET payment ID must match notification ID",()=>{
  assert.equal(run(event,{...provider,id:"pay_other_123456"}).reason,"provider_payment_id_mismatch");
  assert.equal(run(event,null).reason,"provider_response_invalid");
});
test("forged household, subscription, amount and due date fail closed",()=>{
  const variants=[
    [{...provider,externalReference:"other_family"},"household_reference_mismatch"],
    [{...provider,subscription:"sub_other_123456"},"subscription_mismatch"],
    [{...provider,value:39.90},"payment_amount_mismatch"],
    [{...provider,dueDate:"2027-02-13"},"due_date_mismatch"],
    [{...provider,dueDate:"2027-02-30"},"due_date_mismatch"],
  ] as const;
  for(const [candidate,reason] of variants){
    const r=run(event,candidate);
    assert.equal(r.reason,reason);
    assert.equal(r.premiumGranted,false);
    assert.equal(r.writesPerformed,false);
  }
});
test("stale confirmed webhook cannot override provider pending or refused status",()=>{
  assert.equal(run(event,{...provider,status:"PENDING"}).category,"pending");
  assert.equal(run(event,{...provider,status:"OVERDUE"}).reason,"no_settlement");
  assert.equal(run(event,{...provider,status:"CREDIT_CARD_CAPTURE_REFUSED"}).category,"pending");
});
test("provider refund and chargeback require manual review regardless of webhook event",()=>{
  for(const status of ["REFUNDED","PARTIALLY_REFUNDED","CHARGEBACK_REQUESTED"] as const){
    const r=run(event,{...provider,status});
    assert.equal(r.category,"reversal");
    assert.equal(r.reason,"manual_review_required");
    assert.equal(r.premiumGranted,false);
  }
});
test("payment event ID is retained for future deduplication; unknown events never accepted",()=>{
  const r=run({...event,id:"evt_unique_2026",event:"PAYMENT_RECEIVED"});
  assert.equal(r.eventId,"evt_unique_2026");
  assert.equal(run({...event,event:"CHECKOUT_PAID"}).accepted,false);
});
