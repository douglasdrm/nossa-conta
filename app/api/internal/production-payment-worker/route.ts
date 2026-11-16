import { Pool } from "pg";
import { matchesProductionWebhookToken } from "@/lib/production-webhook-auth";
import { processProductionPayment } from "@/lib/production-payment-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

let pool: Pool | undefined;

function database(host: string, project: string, password: string, ca: string) {
  if (!/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) || !/^[a-z0-9]{20}$/.test(project))
    throw new Error("Invalid worker database configuration");
  if (!pool) {
    pool = new Pool({
      host, port: 5432, database: "postgres", user: "nc_production_payment_worker_login." + project,
      password, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000, query_timeout: 8_000, max: 2, allowExitOnIdle: true,
    });
    pool.on("error", () => {});
  }
  return pool;
}

export async function POST(request: Request) {
  const reply = (status: number, result: string) =>
    Response.json({ result }, { status, headers: { "Cache-Control": "no-store" } });
  if (process.env.NC_PRODUCTION_PAYMENT_WORKER_ENABLED !== "true") return reply(503, "disabled");

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!matchesProductionWebhookToken(process.env.NC_PRODUCTION_PAYMENT_WORKER_TOKEN, token))
    return reply(401, "unauthorized");

  const {
    NC_PRODUCTION_INBOX_POOLER_HOST: host,
    NC_PRODUCTION_INBOX_PROJECT_REF: project,
    NC_PRODUCTION_INBOX_CA: ca,
    NC_PRODUCTION_PAYMENT_WORKER_PASSWORD: password,
    ASAAS_PRODUCTION_API_KEY: key,
  } = process.env;
  if (!host || !project || !password || !ca?.trim() || !key) return reply(503, "unconfigured");
  try {
    const db = database(host, project, password, ca);
    const result = await processProductionPayment({
      async claim() {
        return (await db.query("select nossa_conta_private.payment_worker_claim() as value")).rows[0]?.value;
      },
      async context(event, attempt, checkout, reference, subscription) {
        return (await db.query(
          "select nossa_conta_private.payment_worker_context($1,$2,$3,$4,$5) as value",
          [event, attempt, checkout, reference, subscription],
        )).rows[0]?.value;
      },
      async finish(event, attempt, decision, evidence) {
        const query = await db.query<{ value: string }>(
          "select nossa_conta_private.payment_worker_finish($1,$2,$3,$4::jsonb) as value",
          [event, attempt, decision, evidence],
        );
        return query.rows[0]?.value ?? "unknown";
      },
    }, key);
    const ok = ["processed", "retry", "manual_review", "empty", "not_leased"].includes(result);
    return reply(ok ? 200 : 503, ok ? result : "unavailable");
  } catch {
    return reply(503, "unavailable");
  }
}
