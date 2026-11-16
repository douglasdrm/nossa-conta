import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductionWebhookHandler } from "../lib/production-webhook-handler";
import { MAX_PRODUCTION_EVENT_BYTES } from "../lib/production-webhook-ingress";
import type { InboxPersistResult } from "../lib/production-durable-delivery";

const secret = "test-only-production-webhook-token-2026";
const payload = {
  id: "evt_handler_test",
  event: "PAYMENT_CONFIRMED",
  payment: { id: "pay_handler_test", customer: "omitted" },
};

function request(token = secret, body = JSON.stringify(payload)) {
  return new Request("https://example.test/api/billing/production-webhook", {
    method: "POST",
    headers: { "asaas-access-token": token },
    body,
  });
}

test("disabled HTTP handler checks neither secrets nor persistence", async () => {
  const handle = createProductionWebhookHandler({
    enabled: false,
    webhookSecret: () => assert.fail("accessed secret"),
    persist: async () => assert.fail("opened persistence"),
  });
  const response = await handle(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "3600");
  assert.equal((await response.json()).persisted, false);
});

test("HTTP handler rejects bad authentication, malformed bodies and oversized streamed bodies", async () => {
  const handle = createProductionWebhookHandler({
    enabled: true,
    webhookSecret: () => secret,
    persist: async () => assert.fail("opened persistence"),
  });
  assert.equal((await handle(request("wrong"))).status, 401);
  assert.equal((await handle(request(secret, "{"))).status, 400);
  const response = await handle(request(secret, "💵".repeat(MAX_PRODUCTION_EVENT_BYTES / 4 + 1)));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).persisted, false);
});

test("HTTP success waits for durable persistence and forwards only event identifiers", async () => {
  let finish!: (result: InboxPersistResult) => void;
  let started!: () => void;
  const persisted = new Promise<InboxPersistResult>((resolve) => { finish = resolve; });
  const saving = new Promise<void>((resolve) => { started = resolve; });
  const handle = createProductionWebhookHandler({
    enabled: true,
    webhookSecret: () => secret,
    persist: async (event) => {
      assert.deepEqual(event, { id: payload.id, type: payload.event, paymentId: payload.payment.id });
      started();
      return persisted;
    },
  });
  let replied = false;
  const responsePromise = handle(request()).then((response) => { replied = true; return response; });
  await saving;
  assert.equal(replied, false);
  finish("queued");
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).persisted, true);
});

test("HTTP handler returns 503 on database failure and acknowledges a committed duplicate", async () => {
  let attempts = 0;
  const handle = createProductionWebhookHandler({
    enabled: true,
    webhookSecret: () => secret,
    persist: async () => {
      if (++attempts === 1) throw new Error("private database details");
      return "duplicate";
    },
  });
  const failed = await handle(request());
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), {
    received: false, accepted: false, persisted: false, reason: "persistence_failed",
  });
  const retry = await handle(request());
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).reason, "matching_event_already_persisted");
});
