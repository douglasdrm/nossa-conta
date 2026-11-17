import { prepareDurableProductionDelivery, type InboxCommit } from "./production-durable-delivery";
import { matchesProductionWebhookToken } from "./production-webhook-auth";
import {
  disabledProductionIngressResponse,
  MAX_PRODUCTION_EVENT_BYTES,
} from "./production-webhook-ingress";

type HandlerOptions = {
  enabled: boolean;
  webhookSecret: () => string | undefined;
  persist: InboxCommit;
  onAcknowledged?: () => void;
};

class PayloadTooLarge extends Error {}

async function readBody(request: Request): Promise<string> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_PRODUCTION_EVENT_BYTES)) {
    throw new PayloadTooLarge();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      total += value.byteLength;
      if (total > MAX_PRODUCTION_EVENT_BYTES) throw new PayloadTooLarge();
      body += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function reply(status: number, reason: string, accepted = false): Response {
  return Response.json(
    { received: accepted, accepted, persisted: accepted, reason },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function createProductionWebhookHandler(options: HandlerOptions) {
  return async (request: Request): Promise<Response> => {
    if (!options.enabled) return disabledProductionIngressResponse();

    const webhookSecret = options.webhookSecret();
    const receivedToken = request.headers.get("asaas-access-token");
    if (!matchesProductionWebhookToken(webhookSecret, receivedToken)) {
      return reply(401, "unauthorized");
    }

    let rawBody: string;
    try {
      rawBody = await readBody(request);
    } catch (error) {
      return error instanceof PayloadTooLarge
        ? reply(413, "payload_too_large")
        : reply(400, "invalid_body");
    }

    const result = await prepareDurableProductionDelivery({
      explicitlyEnabled: options.enabled,
      webhookSecret,
      receivedToken,
      rawBody,
      maxBytes: MAX_PRODUCTION_EVENT_BYTES,
    }, options.persist);

    const accepted = result.acknowledged && result.durable;
    if (accepted) {
      try {
        options.onAcknowledged?.();
      } catch {
        // The queue retains committed events for the scheduled worker.
      }
    }
    return reply(result.status, result.reason, accepted);
  };
}
