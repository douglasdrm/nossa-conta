import { after } from "next/server";
import { runProductionPaymentWorker } from "@/lib/production-payment-runtime";
import { createProductionInboxConnection } from "@/lib/production-inbox-connection";
import { createProductionWebhookHandler } from "@/lib/production-webhook-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Production delivery requires explicit deployment configuration and database controls.
const productionWebhookEnabled = process.env.VERCEL_ENV === "production" &&
  process.env.NC_PRODUCTION_WEBHOOK_ENABLED === "true";
let inbox: ReturnType<typeof createProductionInboxConnection> | undefined;

const handle = createProductionWebhookHandler({
  enabled: productionWebhookEnabled,
  webhookSecret: () => process.env.ASAAS_PRODUCTION_WEBHOOK_TOKEN,
  onAcknowledged: () => {
    after(async () => { await runProductionPaymentWorker(); });
  },
  persist: (event) => {
    if (!inbox) {
      const {
        NC_PRODUCTION_INBOX_POOLER_HOST: host,
        NC_PRODUCTION_INBOX_PROJECT_REF: projectRef,
        NC_PRODUCTION_INBOX_PASSWORD: password,
        NC_PRODUCTION_INBOX_CA: ca,
      } = process.env;
      if (!host || !projectRef || !password || !ca?.trim()) {
        throw new Error("Production inbox connection is not configured");
      }
      inbox = createProductionInboxConnection({ host, projectRef, password, ca });
    }
    return inbox.persist(event);
  },
});

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
