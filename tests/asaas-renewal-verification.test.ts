import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedSandboxRenewalPayment } from "../lib/asaas-renewal-verification";

const id="pay_renewal_123456", sub="sub_renewal_123456";
const payment = {id, subscription:sub, value:14.9,
  dueDate:"2026-12-13", status:"RECEIVED"};
test("accepts settled provider response only for exact charge and subscription", () => {
  assert.deepEqual(verifiedSandboxRenewalPayment(id,sub,payment),{
    id,subscription:sub,amount:1490,dueDate:"2026-12-13",status:"RECEIVED"
  });
  assert.equal(verifiedSandboxRenewalPayment(id,sub,{...payment,status:"CONFIRMED"})?.status,"CONFIRMED");
});
test("refuses spoofed or stale charges, unconfirmed status and invalid dates", () => {
  assert.equal(verifiedSandboxRenewalPayment("pay_different",sub,payment),null);
  assert.equal(verifiedSandboxRenewalPayment(id,"sub_other_98765",payment),null);
  assert.equal(verifiedSandboxRenewalPayment(id,sub,{...payment,status:"PENDING"}),null);
  assert.equal(verifiedSandboxRenewalPayment(id,sub,{...payment,status:"REFUNDED"}),null);
  assert.equal(verifiedSandboxRenewalPayment(id,sub,{...payment,dueDate:"2026-02-30"}),null);
  assert.equal(verifiedSandboxRenewalPayment(id,sub,{...payment,value:NaN}),null);
});
