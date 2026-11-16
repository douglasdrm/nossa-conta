import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspectProductionIngress,disabledProductionIngressResponse,
  MAX_PRODUCTION_EVENT_BYTES,
} from "../lib/production-webhook-ingress";
import { POST } from "../app/api/billing/production-webhook/route";

const secret="Example_Webhook_Secret_Used_Only_In_Unit_Tests_2026";
const event=JSON.stringify({id:"evt_fixture_123456",event:"PAYMENT_CONFIRMED",
  payment:{id:"pay_fixture_123456"},status:"CONFIRMED",customer:{name:"must_not_store"}});
test("unconfigured, invalid and missing tokens cannot pass offline ingress validation",()=>{
  for(const provided of [null,"incorrect_token","invalid-but-very-long-token-1234567890"]){
    const result=inspectProductionIngress(secret,provided,0,event);
    assert.equal(result.status,401);
    assert.equal(result.persisted,false);
    assert.equal(result.accepted,false);
  }
  assert.equal(inspectProductionIngress(undefined,secret,0,event).status,401);
});
test("validated notifications still receive disabled response and never persist",()=>{
  const r=inspectProductionIngress(secret,secret,Buffer.byteLength(event),event);
  assert.deepEqual(r,{
    status:503,reason:"production_ingress_disabled",persisted:false,
    accepted:false,eventId:"evt_fixture_123456",paymentId:"pay_fixture_123456",
  });
});
test("invalid JSON, status, payment ID and event type are rejected",()=>{
  assert.equal(inspectProductionIngress(secret,secret,5,"{no:}").status,400);
  assert.equal(inspectProductionIngress(secret,secret,1,
    JSON.stringify({id:"evt_xxx",event:"CHECKOUT_PAID",payment:{id:"pay_012345"}})).status,400);
  assert.equal(inspectProductionIngress(secret,secret,1,
    JSON.stringify({id:"evt_xxx",event:"PAYMENT_RECEIVED",payment:{id:"wrong"}})).status,400);
});
test("bounds body by UTF-8 bytes, not only character length",()=>{
  assert.equal(inspectProductionIngress(secret,secret,MAX_PRODUCTION_EVENT_BYTES+1,event).status,413);
  assert.equal(inspectProductionIngress(secret,secret,1,"💵".repeat(17000)).status,413);
  assert.equal(inspectProductionIngress(secret,secret,-1,event).status,413);
});
test("actual network route returns 503 even with a valid-looking token or payload",async()=>{
  const request=new Request("https://nossaconta.unodev.com.br/api/billing/production-webhook",{
    method:"POST",headers:{"asaas-access-token":secret,"content-type":"application/json"},
    body:event,
  });
  const response=await POST(request);
  assert.equal(response.status,503);
  assert.equal(response.headers.get("cache-control"),"no-store");
  assert.equal(response.headers.get("retry-after"),"3600");
  assert.deepEqual(await response.json(),{
    received:false,accepted:false,persisted:false,error:"Production webhook disabled",
  });
});
test("multiple repeated deliveries are never acknowledged or persisted",async()=>{
  for(let i=0;i<3;i++){
    const response=await POST(new Request("https://nossaconta.unodev.com.br/api/billing/production-webhook",{
      method:"POST",body:event,
    }));
    assert.equal(response.status,503);
    assert.equal((await response.json()).persisted,false);
  }
});
