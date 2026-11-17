import { createHash } from "node:crypto";
import { matchesProductionWebhookToken } from "@/lib/production-webhook-auth";
import { inspectProductionIngress, MAX_PRODUCTION_EVENT_BYTES } from "@/lib/production-webhook-ingress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (status: number) => new Response(null, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.VERCEL_GIT_COMMIT_REF !== "test/asaas-sandbox-live") return reply(404);

  const secret = process.env.NC_ASAAS_SANDBOX_WEBHOOK_TOKEN;
  const token = request.headers.get("asaas-access-token");
  if (!matchesProductionWebhookToken(secret, token)) return reply(401);
  const key = process.env.NC_ASAAS_SANDBOX_API_KEY;
  const checkout = process.env.NC_ASAAS_SANDBOX_CHECKOUT_ID;
  if (!key || !checkout) return reply(503);

  const reader = request.body?.getReader();
  if (!reader) return reply(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PRODUCTION_EVENT_BYTES) {
        void reader.cancel().catch(() => {});
        return reply(413);
      }
      chunks.push(value);
    }
  } catch {
    return reply(400);
  } finally {
    reader.releaseLock();
  }

  const event = inspectProductionIngress(secret, token, size, Buffer.concat(chunks).toString("utf8"));
  if (!event.eventId || !event.paymentId) return reply(event.status);

  try {
    const response = await fetch("https://api-sandbox.asaas.com/v3/payments/" + event.paymentId, {
      headers: { access_token: key, "User-Agent": "NossaConta/SandboxPreview" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404) return reply(200);
    if (!response.ok) return reply(503);
    const payment = await response.json();
    if (payment.id === event.paymentId && payment.checkoutSession === checkout) {
      console.info("NC_ASAAS_SANDBOX_DELIVERY verified " +
        createHash("sha256").update(event.eventId).digest("hex").slice(0, 16));
    }
    // The probe verifies delivery only and never writes to a billing database.
    return reply(200);
  } catch {
    return reply(503);
  }
}
