import { z } from "zod";
import { matchesProductionWebhookToken } from "./production-webhook-auth";

/**
 * A staging-only ingress contract for the future production webhook.
 * It never writes to the persistent inbox. Activation REQUIRES new,
 * independently reviewed server code; setting env vars is insufficient.
 */
const eventSchema = z.object({
  id:z.string().min(3).max(250),
  event:z.enum([
    "PAYMENT_CREATED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED",
    "PAYMENT_OVERDUE","PAYMENT_REFUNDED","PAYMENT_PARTIALLY_REFUNDED",
    "PAYMENT_CHARGEBACK_REQUESTED","PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  ]),
  payment:z.object({id:z.string().regex(/^pay_[A-Za-z0-9_-]{3,120}$/)}),
}).passthrough();

export type IngressResult = {
  status: 401|400|413|503;
  reason:string;
  eventId?:string;
  paymentId?:string;
  persisted:false;
  accepted:false;
};
export const MAX_PRODUCTION_EVENT_BYTES=64_000;

/** Parse safely for offline tests, without accepting or persisting a delivery. */
export function inspectProductionIngress(
  token:string|undefined,providedToken:string|null,
  contentLength:number,raw:string,
):IngressResult {
  const blocked=(status:IngressResult["status"],reason:string):IngressResult=>({
    status,reason,persisted:false,accepted:false,
  });
  if(!matchesProductionWebhookToken(token,providedToken))
    return blocked(401,"unauthorized");
  if(!Number.isSafeInteger(contentLength)||contentLength<0||
     contentLength>MAX_PRODUCTION_EVENT_BYTES||
     Buffer.byteLength(raw,"utf8")>MAX_PRODUCTION_EVENT_BYTES)
    return blocked(413,"payload_too_large");
  let json:unknown;
  try {json=JSON.parse(raw);} catch {return blocked(400,"invalid_json");}
  const parsed=eventSchema.safeParse(json);
  if(!parsed.success)return blocked(400,"invalid_event");
  return {
    ...blocked(503,"production_ingress_disabled"),
    eventId:parsed.data.id,paymentId:parsed.data.payment.id,
  };
}

/**
 * The actual network boundary is unconditionally fail-closed. This MUST
 * remain a literal code constant until a separate approved launch.
 * Do not use environment variables as a bypass.
 */
export function disabledProductionIngressResponse():Response {
  return Response.json(
    {received:false,accepted:false,persisted:false,error:"Production webhook disabled"},
    {status:503,headers:{"Cache-Control":"no-store","Retry-After":"3600"}},
  );
}
