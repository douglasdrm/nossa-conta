import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxLifecycleNotification, monitoredAsaasEvents } from "../lib/asaas-lifecycle";

test("maps confirmed recurring payment to its subscription and exact cents", () => {
  const e = sandboxLifecycleNotification({
    id:"evt_1", event:"PAYMENT_CONFIRMED",
    payment:{ id:"pay_123", subscription:"sub_123456", value:14.9 },
  });
  assert.deepEqual(e, {
    id:"evt_1",type:"PAYMENT_CONFIRMED",resource:"payment",
    resourceId:"pay_123",subscriptionId:"sub_123456",amount:1490,
  });
});

test("recognizes cancellation and chargeback without treating them as payment success", () => {
  const subscription = sandboxLifecycleNotification({
    id:"evt_2",event:"SUBSCRIPTION_INACTIVATED",subscription:{id:"sub_123456"},
  });
  assert.equal(subscription?.type,"SUBSCRIPTION_INACTIVATED");
  assert.equal(subscription?.resource,"subscription");
  assert.equal(subscription?.amount,null);
  const refund = sandboxLifecycleNotification({
    id:"evt_3",event:"PAYMENT_REFUNDED",payment:{id:"pay_2",subscription:"sub_123456",value:14.9},
  });
  assert.equal(refund?.type,"PAYMENT_REFUNDED");
  assert.ok(monitoredAsaasEvents.includes("PAYMENT_CHARGEBACK_REQUESTED"));
});

test("ignores unrelated accounts and bad notification bodies", () => {
  assert.equal(sandboxLifecycleNotification({ id:"evt_4",event:"PAYMENT_RECEIVED",payment:{id:"pay_3",value:14.9} }),null);
  assert.equal(sandboxLifecycleNotification({ id:"evt_5",event:"SOME_NEW_EVENT",subscription:{id:"sub_123456"} }),null);
  assert.equal(sandboxLifecycleNotification({ id:"evt_6",event:"PAYMENT_RECEIVED",payment:{id:"pay_3",subscription:"sub_123456",value:-14.9} }),null);
  assert.equal(sandboxLifecycleNotification({ id:"evt_7",event:"CHECKOUT_PAID" }),null);
});
