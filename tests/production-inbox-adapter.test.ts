import {test} from "node:test";
import assert from "node:assert/strict";
import {productionInboxAdapter,restrictedProductionInboxAdapter} from "../lib/production-inbox-adapter";

const fixture={id:"evt_adapter_012345",type:"PAYMENT_RECEIVED" as const,paymentId:"pay_adapter_012345"};
test("adapter uses parameterized owner-only function and retains only event identifiers",async()=>{
  const calls:{sql:string;values:readonly string[]}[]=[];
  const persist=productionInboxAdapter(async(sql,values)=>{
    calls.push({sql,values});
    return [{outcome:"queued"}];
  });
  assert.equal(await persist(fixture),"queued");
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/nossa_conta_private\.enqueue_production_event_internal/);
  assert.match(calls[0].sql,/\$1::text,\$2::text,\$3::text/);
  assert.deepEqual(calls[0].values,[
    "evt_adapter_012345","PAYMENT_RECEIVED","pay_adapter_012345",
  ]);
  assert.ok(!calls[0].sql.includes(fixture.id));
});
test("adapter accepts each known result but fails closed for unexpected DB output",async()=>{
  for(const outcome of ["duplicate","event_id_conflict","invalid","production_inbox_disabled"]){
    const persist=productionInboxAdapter(async()=>[{outcome}]);
    assert.equal(await persist(fixture),outcome);
  }
  const malformed=[[],[{outcome:"success"}],[{outcome:"queued"},{outcome:"queued"}],[{outcome:null}]];
  for(const rows of malformed){
    const persist=productionInboxAdapter(async()=>rows);
    await assert.rejects(()=>persist(fixture),/Unexpected production inbox result/);
  }
  const broken=productionInboxAdapter(async()=>{throw new Error("database unavailable");});
  await assert.rejects(()=>broken(fixture),/database unavailable/);
});

test("restricted adapter invokes gateway rather than owner-only function",async()=>{
  let called="";
  const persist=restrictedProductionInboxAdapter(async(sql,params)=>{
    called=sql;
    assert.deepEqual(params,[
      "evt_adapter_012345","PAYMENT_RECEIVED","pay_adapter_012345",
    ]);
    return [{outcome:"production_inbox_disabled"}];
  });
  assert.equal(await persist(fixture),"production_inbox_disabled");
  assert.match(called,/enqueue_production_event_gateway/);
  assert.ok(!called.includes("enqueue_production_event_internal"));
});
