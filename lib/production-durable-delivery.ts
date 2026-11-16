import { z } from "zod";
import { matchesProductionWebhookToken } from "./production-webhook-auth";

/**
 * Server-only future delivery orchestration. NOT imported by the active route.
 * The caller must supply a trusted, transactional database adapter; no provider
 * API call, billing mutation or entitlement is performed here.
 */
export const deliverySchema = z.object({
  id:z.string().min(3).max(250),
  event:z.enum([
    "PAYMENT_CREATED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED",
    "PAYMENT_OVERDUE","PAYMENT_REFUNDED","PAYMENT_PARTIALLY_REFUNDED",
    "PAYMENT_CHARGEBACK_REQUESTED","PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  ]),
  payment:z.object({
    id:z.string().regex(/^pay_[A-Za-z0-9_-]{3,120}$/),
  }),
}).passthrough();

export type DurableEvent = {
  id:string;
  type:z.infer<typeof deliverySchema>["event"];
  paymentId:string;
};
export type InboxPersistResult =
  | "queued" | "duplicate" | "event_id_conflict"
  | "production_inbox_disabled" | "invalid";
export type InboxCommit = (event:DurableEvent)=>Promise<InboxPersistResult>;
export type DeliveryResponse = {
  status:200|400|401|409|413|503;
  acknowledged:boolean;
  durable:boolean;
  reason:string;
};
const fail=(status:DeliveryResponse["status"],reason:string):DeliveryResponse=>({
  status,reason,acknowledged:false,durable:false,
});

/**
 * An explicit authorisation gate is required in addition to the existing
 * SQL control; both default to disabled. A successful HTTP acknowledgement
 * is possible ONLY when the adapter has committed a matching event or
 * confirmed a matching duplicate transactionally.
 *
 * On provider/DB outage or malformed duplicate, fail closed so the sender
 * can retry. Does not leak event data, token or error details in its result.
 */
export async function prepareDurableProductionDelivery(
  args:{
    explicitlyEnabled:boolean;
    webhookSecret:string|undefined;
    receivedToken:string|null;
    rawBody:string;
    maxBytes?:number;
  },
  persist:InboxCommit,
):Promise<DeliveryResponse>{
  if(!args.explicitlyEnabled) return fail(503,"ingress_not_approved");
  if(!matchesProductionWebhookToken(args.webhookSecret,args.receivedToken))
    return fail(401,"unauthorized");
  const limit=Math.min(64_000,Math.max(1,args.maxBytes??64_000));
  if(Buffer.byteLength(args.rawBody,"utf8")>limit)
    return fail(413,"payload_too_large");
  let payload:unknown;
  try {payload=JSON.parse(args.rawBody);}catch{return fail(400,"invalid_json");}
  const parsed=deliverySchema.safeParse(payload);
  if(!parsed.success)return fail(400,"invalid_event");
  const event:DurableEvent={
    id:parsed.data.id,type:parsed.data.event,paymentId:parsed.data.payment.id,
  };
  let result:InboxPersistResult;
  try{result=await persist(event);}catch{return fail(503,"persistence_failed");}
  switch(result){
    case "queued": return {status:200,acknowledged:true,durable:true,reason:"persisted"};
    case "duplicate": return {status:200,acknowledged:true,durable:true,reason:"matching_event_already_persisted"};
    case "event_id_conflict": return fail(409,"event_id_conflict");
    case "invalid": return fail(400,"invalid_event");
    case "production_inbox_disabled": return fail(503,"production_inbox_disabled");
    default:return fail(503,"unrecognized_persistence_result");
  }
}
