import { createHash, timingSafeEqual } from "node:crypto";
import { processProductionPayment } from "@/lib/production-payment-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenHash = Buffer.from("e161b1624619b75041649ebf96e09ada5f6410003e374ad6c70d3d63be990208", "hex");
const eventId = "evt_sandbox_cron_probe";
const paymentId = "pay_sandbox_cron_probe";
const subscriptionId = "sub_sandbox_cron_probe";

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.VERCEL_GIT_COMMIT_REF !== "test/asaas-sandbox-live") return new Response(null, { status: 404 });
  const authorization = request.headers.get("authorization") ?? "";
  const suppliedHash = createHash("sha256").update(authorization.slice(7)).digest();
  if (!authorization.startsWith("Bearer ") || !timingSafeEqual(tokenHash, suppliedHash)) {
    return new Response(null, { status: 401 });
  }

  // A fixture representing a previously attempted renewal. No database or provider is modified.
  let state: "retry" | "processing" | "processed" = "retry";
  const run = () => processProductionPayment({
    async claim() {
      if (state !== "retry") return { result: "empty" };
      state = "processing";
      return { result: "claimed", event_id: eventId, event_type: "PAYMENT_RECEIVED", payment_id: paymentId, attempts: 2 };
    },
    async context(event, attempt, checkout, reference, subscription) {
      if (event !== eventId || attempt !== 2 || checkout || reference || subscription !== subscriptionId) {
        throw new Error("Unexpected retry context");
      }
      return { kind: "renewal", cycle: "monthly" };
    },
    async finish(event, attempt, decision, evidence) {
      if (event !== eventId || attempt !== 2 || state !== "processing" ||
          decision !== "apply" || !evidence || !("kind" in evidence) || evidence.kind !== "renewal") {
        throw new Error("Expected the retried renewal to be applied");
      }
      state = "processed";
      return state;
    },
  }, "sandbox-fixture-key", async (input) => {
    const url = String(input);
    if (url === "https://api.asaas.com/v3/payments/" + paymentId) {
      return Response.json({
        id: paymentId, status: "RECEIVED", billingType: "CREDIT_CARD",
        value: 14.9, dueDate: "2026-11-17", subscription: subscriptionId,
      });
    }
    if (url === "https://api.asaas.com/v3/subscriptions/" + subscriptionId) {
      return Response.json({ id: subscriptionId, cycle: "MONTHLY" });
    }
    return new Response(null, { status: 404 });
  });

  try {
    if (await run() === "processed" && await run() === "empty") {
      return Response.json({ result: "sandbox_retry_processed" }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch {
    // Return a stable signal without logging credentials or fixtures.
  }
  return Response.json({ result: "sandbox_retry_failed" }, { status: 503 });
}
