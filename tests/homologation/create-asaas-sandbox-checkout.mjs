import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { checkoutPayload } = require("../../lib/asaas.ts");

assert.equal(process.env.VERCEL_ENV, "preview");
assert.equal(process.env.VERCEL_GIT_COMMIT_REF, "test/asaas-sandbox-live");
const key = process.env.NC_ASAAS_SANDBOX_API_KEY;
if (!key) throw new Error("Missing Asaas Sandbox API key");
const symbol = await readFile("public/brand/symbol-white.svg");
const imageBase64 = (await sharp(symbol).resize(160, 160).flatten({ background: "#185540" }).png().toBuffer()).toString("base64");
const response = await fetch("https://api-sandbox.asaas.com/v3/checkouts", {
  method: "POST",
  headers: {
    access_token: key, "Content-Type": "application/json", "User-Agent": "NossaConta/SandboxPreview",
  },
  body: JSON.stringify(checkoutPayload(randomUUID(), "monthly", "card", imageBase64)),
  redirect: "error", signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error("Asaas Sandbox checkout creation failed (HTTP " + response.status + ")");
const data = await response.json();
if (typeof data?.id !== "string" || !/^[A-Za-z0-9_-]{10,100}$/.test(data.id)) {
  throw new Error("Asaas Sandbox returned an invalid checkout identifier");
}
console.log("NC_SANDBOX_CHECKOUT_URL https://sandbox.asaas.com/checkoutSession/show?" + new URLSearchParams({ id: data.id }));
