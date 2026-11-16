import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ExpectedProductionCharge } from "./production-reconciliation-preview";

/**
 * Production webhook verification BLUEPRINT, not an endpoint.
 *
 * The HTTP server must independently authenticate this notification, then GET
 * /v3/payments/{id} using a PRODUCTION API key, before any future write.
 * No production API key or public webhook route is supplied by this module.
 */
const paymentId = z.string().regex(/^pay_[A-Za-z0-9_-]{3,120}$/);
const eventId = z.string().min(3).max(250);
const statusSchema = z.enum([
  "PENDING","CONFIRMED","RECEIVED","OVERDUE","REFUNDED",
  "PARTIALLY_REFUNDED","CHARGEBACK_REQUESTED","CANCELED",
  "CREDIT_CARD_CAPTURE_REFUSED",
]);
const webhookSchema = z.object({
  id:eventId,
  event:z.string().min(5).max(100),
  payment:z.object({id:paymentId}).passthrough(),
}).passthrough();
const providerSchema = z.object({
  id:paymentId,
  subscription:z.string().regex(/^sub_[A-Za-z0-9_-]{6,100}$/),
  externalReference:z.string().min(1).max(150).nullish(),
  value:z.number().finite().positive(),
  dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status:statusSchema,
}).passthrough();

export type WebhookVerification = {
  accepted:boolean;
  category:"settled"|"pending"|"reversal"|"unsupported"|"invalid";
  reason:string;
  paymentId:string|null;
  eventId:string|null;
  writesPerformed:false;
  premiumGranted:false;
};

const types = new Set([
  "PAYMENT_CREATED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE","PAYMENT_REFUNDED","PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED","PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
]);
const settled = new Set(["CONFIRMED","RECEIVED"]);
const reversed = new Set(["REFUNDED","PARTIALLY_REFUNDED","CHARGEBACK_REQUESTED"]);

function isRealDate(date: string): boolean {
  const d = new Date(date+"T00:00:00.000Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === date;
}

/**
 * Compare configured, secret webhook authToken to request header.
 * Never use an Asaas API key as a webhook authToken.
 */
export function matchesProductionWebhookToken(
  configuredToken: string | undefined,
  receivedHeader: string | null,
): boolean {
  if (!configuredToken || !receivedHeader ||
      configuredToken.length < 32 || configuredToken.length > 255 ||
      /\s/.test(configuredToken)) return false;
  const a=Buffer.from(configuredToken,"utf8");
  const b=Buffer.from(receivedHeader,"utf8");
  return a.length===b.length && timingSafeEqual(a,b);
}

/**
 * Two separate trust boundaries:
 *  1. authenticated webhook is only a notification;
 *  2. providerPayment must be the independent GET /payments/{id} response.
 * The caller cannot claim "verified" by setting a property on the event.
 * Every outcome is advisory, including a matched settled payment.
 */
export function inspectProductionWebhookAgainstProvider(
  payload: unknown,
  providerPayment: unknown,
  expected: ExpectedProductionCharge,
  authenticated: boolean,
): WebhookVerification {
  const base={writesPerformed:false as const,premiumGranted:false as const};
  const fail=(reason:string,category:"invalid"|"unsupported"="invalid"):WebhookVerification=>({
    accepted:false,category,reason,paymentId:null,eventId:null,...base,
  });
  if (!authenticated) return fail("webhook_authentication_failed");
  const event=webhookSchema.safeParse(payload);
  if (!event.success) return fail("webhook_schema_invalid");
  if (!types.has(event.data.event)) return fail("event_type_not_supported","unsupported");
  const payment=providerSchema.safeParse(providerPayment);
  if (!payment.success) return fail("provider_response_invalid");
  const p=payment.data;
  if (p.id!==event.data.payment.id) return fail("provider_payment_id_mismatch");
  if (p.subscription!==expected.subscriptionId) return fail("subscription_mismatch");
  if (!expected.householdId || p.externalReference!==expected.householdId)
    return fail("household_reference_mismatch");
  if (!Number.isSafeInteger(expected.amountCents) || expected.amountCents<=0 ||
      Math.round(p.value*100)!==expected.amountCents)
    return fail("payment_amount_mismatch");
  if (!isRealDate(expected.dueDate) || !isRealDate(p.dueDate) ||
      expected.dueDate!==p.dueDate) return fail("due_date_mismatch");
  const category = reversed.has(p.status) ? "reversal" :
    settled.has(p.status) ? "settled" : "pending";
  return {
    accepted:true,category,
    reason:category==="settled"?"verified_settlement_candidate" :
      category==="reversal"?"manual_review_required":"no_settlement",
    paymentId:p.id,eventId:event.data.id,...base,
  };
}
