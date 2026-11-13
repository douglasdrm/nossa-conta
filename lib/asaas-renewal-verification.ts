import type { AsaasCharge } from "./asaas-renewal-reconciliation";

/** Fail closed: never accept the webhook body as proof of a paid renewal. */
export function verifiedSandboxRenewalPayment(
  expectedId: string,
  expectedSubscription: string,
  payment: AsaasCharge,
): {id:string;subscription:string;amount:number;dueDate:string;status:string} | null {
  if (!/^pay_[A-Za-z0-9_-]{3,120}$/.test(expectedId) ||
      payment.id !== expectedId || payment.subscription !== expectedSubscription ||
      !/^sub_[A-Za-z0-9_-]{6,100}$/.test(expectedSubscription) ||
      !["CONFIRMED","RECEIVED"].includes(payment.status) ||
      !Number.isFinite(payment.value) || payment.value <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate)) return null;
  const parsed = new Date(payment.dueDate + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0,10) !== payment.dueDate) return null;
  const amount = Math.round(payment.value * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return {
    id: payment.id,
    subscription: expectedSubscription,
    amount, dueDate: payment.dueDate, status: payment.status,
  };
}
