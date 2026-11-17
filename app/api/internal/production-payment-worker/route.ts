import { matchesProductionWebhookToken } from "@/lib/production-webhook-auth";
import { runProductionPaymentWorker } from "@/lib/production-payment-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const reply = (status: number, result: string) =>
    Response.json({ result }, { status, headers: { "Cache-Control": "no-store" } });
  if (process.env.NC_PRODUCTION_PAYMENT_WORKER_ENABLED !== "true") return reply(503, "disabled");

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!matchesProductionWebhookToken(process.env.NC_PRODUCTION_PAYMENT_WORKER_TOKEN, token))
    return reply(401, "unauthorized");

  const result = await runProductionPaymentWorker();
  const ok = ["processed", "retry", "manual_review", "empty", "not_leased"].includes(result);
  return reply(ok ? 200 : 503, result);
}
