import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

assert.equal(process.env.VERCEL_ENV, "preview");
assert.equal(process.env.VERCEL_GIT_COMMIT_REF, "test/asaas-supabase-pooler");
const password = process.env.NC_PREVIEW_INBOX_PASSWORD;
const host = process.env.NC_PREVIEW_POOLER_HOST;
const ca = process.env.NC_PREVIEW_POOLER_CA;

if (!password) {
  console.log("NC_POOLER_CHECK: setup pending (no preview credential)");
} else {
  assert.ok(host, "Missing session pooler hostname");
  const require = createRequire(import.meta.url);
  const { createProductionInboxConnection } = require("../../lib/production-inbox-connection.ts");
  const connection = createProductionInboxConnection({
    host,
    projectRef: "pmbjfegzwvlgxkpywzcq",
    password,
    ca,
  });

  try {
    const result = await connection.persist({
      id: "evt_preview_" + randomUUID(),
      type: "PAYMENT_CONFIRMED",
      // This deliberately fails the gateway validation even if the control is enabled.
      paymentId: "invalid_preview_payment_id",
    });
    assert.equal(result, "production_inbox_disabled");
    console.log("NC_POOLER_CHECK: TLS, dedicated login, role transition and disabled gateway verified");
  } catch (error) {
    const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "UNEXPECTED";
    throw new Error("NC_POOLER_CHECK failed (" + code + ")");
  } finally {
    await connection.close();
  }
}
