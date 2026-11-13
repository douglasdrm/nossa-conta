import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSandboxPaymentBook } from "../lib/asaas";

test("Sandbox payment book rejects unknown subscription identifiers before any network access", async () => {
  await assert.rejects(() => generateSandboxPaymentBook("wrong", "2026-12-13"), /inválido/);
  await assert.rejects(() => generateSandboxPaymentBook("sub_valid_12345", "not-a-date"), /inválido/);
  await assert.rejects(() => generateSandboxPaymentBook("sub_valid_12345", "2026-1-1"), /inválido/);
});
