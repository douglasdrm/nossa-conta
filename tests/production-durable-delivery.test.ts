import {test} from "node:test";
import assert from "node:assert/strict";
import {
  prepareDurableProductionDelivery as deliver,
  type DurableEvent,
  type InboxCommit,
  type InboxPersistResult,
} from "../lib/production-durable-delivery";
import {POST} from "../app/api/billing/production-webhook/route";

const secret="FictitiousWebhookAuthToken_0123456789_2026";
const raw=JSON.stringify({
  id:"evt_durable_012345",event:"PAYMENT_CONFIRMED",
  payment:{id:"pay_durable_012345",value:99999,customer:"ignored"},
  card:{secret:"never_store"},
});
const args={explicitlyEnabled:true,webhookSecret:secret,receivedToken:secret,rawBody:raw};
test("disabled gate precedes authentication and never invokes persistence",async()=>{
  let calls=0;
  const r=await deliver({...args,explicitlyEnabled:false},async()=>{calls++;return "queued";});
  assert.deepEqual(r,{status:503,acknowledged:false,durable:false,reason:"ingress_not_approved"});
  assert.equal(calls,0);
});
test("invalid token, JSON, event, and oversize payload cannot invoke adapter",async()=>{
  let calls=0;
  const adapter:InboxCommit=async()=>{calls++;return "queued";};
  assert.equal((await deliver({...args,receivedToken:"unauthorized"},adapter)).status,401);
  assert.equal((await deliver({...args,webhookSecret:undefined},adapter)).status,401);
  assert.equal((await deliver({...args,rawBody:"{not valid"},adapter)).status,400);
  assert.equal((await deliver({...args,rawBody:JSON.stringify({id:"evt_valid",event:"CHECKOUT_PAID",payment:{id:"pay_valid001"}})},adapter)).status,400);
  assert.equal((await deliver({...args,rawBody:"💳".repeat(17000)},adapter)).status,413);
  assert.equal(calls,0);
});
test("200 is returned only after a committed, minimal matching event",async()=>{
  let invocation:DurableEvent|null=null;
  const result=await deliver(args,async event=>{
    invocation=event;
    return "queued";
  });
  assert.deepEqual(invocation,{
    id:"evt_durable_012345",type:"PAYMENT_CONFIRMED",paymentId:"pay_durable_012345",
  });
  assert.deepEqual(result,{
    status:200,acknowledged:true,durable:true,reason:"persisted",
  });
});
test("matching replays can acknowledge only after durable duplicate check",async()=>{
  const seen=new Map<string,DurableEvent>();
  const adapter:InboxCommit=async event=>{
    const saved=seen.get(event.id);
    if(saved){
      return saved.type===event.type && saved.paymentId===event.paymentId?
        "duplicate":"event_id_conflict";
    }
    seen.set(event.id,event);
    return "queued";
  };
  assert.equal((await deliver(args,adapter)).reason,"persisted");
  assert.equal((await deliver(args,adapter)).reason,"matching_event_already_persisted");
  const collision={...args,rawBody:JSON.stringify({
    id:"evt_durable_012345",event:"PAYMENT_REFUNDED",payment:{id:"pay_other_012345"},
  })};
  const result=await deliver(collision,adapter);
  assert.equal(result.status,409);
  assert.equal(result.acknowledged,false);
  assert.equal(seen.size,1);
});
test("database errors, disabled inbox and invalid persistence cannot be acknowledged",async()=>{
  const cases:InboxPersistResult[]=[
    "production_inbox_disabled","invalid","event_id_conflict",
  ];
  for(const outcome of cases){
    const result=await deliver(args,async()=>outcome);
    assert.equal(result.acknowledged,false);
    assert.equal(result.durable,false);
    assert.notEqual(result.status,200);
  }
  assert.equal((await deliver(args,async()=>{throw new Error("sensitive DB failure");})).reason,"persistence_failed");
  assert.equal((await deliver(args,async()=>{throw new Error("sensitive DB failure");})).status,503);
});
test("network endpoint remains hard-disabled even if a valid adapter could be supplied elsewhere",async()=>{
  const response=await POST(new Request("https://nossaconta.unodev.com.br/api/billing/production-webhook",{
    method:"POST",headers:{"asaas-access-token":secret},body:raw,
  }));
  assert.equal(response.status,503);
  assert.equal((await response.json()).persisted,false);
});
