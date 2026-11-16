import { disabledProductionIngressResponse } from "@/lib/production-webhook-ingress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reserved URL for a future Asaas production webhook.
 * It is deliberately NOT a functioning webhook listener.
 * No credentials, request payload, provider GET or DB insert are performed.
 *
 * A future launch needs authenticated ingress + durable enqueue BEFORE a
 * successful acknowledgement, followed by independent Asaas verification.
 */
export async function POST(_request:Request):Promise<Response> {
  return disabledProductionIngressResponse();
}
