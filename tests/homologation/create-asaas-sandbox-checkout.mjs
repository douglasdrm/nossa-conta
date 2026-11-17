import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

assert.equal(process.env.VERCEL_ENV, "preview");
assert.equal(process.env.VERCEL_GIT_COMMIT_REF, "test/asaas-sandbox-live");
const key = process.env.NC_ASAAS_SANDBOX_API_KEY;
if (!key) throw new Error("Missing Asaas Sandbox API key");
const host = process.env.VERCEL_URL;
if (!host || !/^[a-z0-9-]+\.vercel\.app$/.test(host)) throw new Error("Unexpected Preview URL");
const callbackUrl = "https://" + host + "/assinatura?periodo=monthly";
const dueDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const symbol = await readFile("public/brand/symbol-white.svg");
const imageBase64 = (await sharp(symbol).resize(160, 160).flatten({ background: "#185540" }).png().toBuffer()).toString("base64");
const response = await fetch("https://api-sandbox.asaas.com/v3/checkouts", {
  method: "POST",
  headers: {
    access_token: key, "Content-Type": "application/json", "User-Agent": "NossaConta/SandboxPreview",
  },
  body: JSON.stringify({
    billingTypes: ["CREDIT_CARD"], chargeTypes: ["RECURRENT"], minutesToExpire: 1440,
    externalReference: randomUUID(),
    subscription: { cycle: "MONTHLY", nextDueDate: dueDate },
    callback: { successUrl: callbackUrl + "&retorno=success", cancelUrl: callbackUrl + "&retorno=cancel",
      expiredUrl: callbackUrl + "&retorno=expired" },
    items: [{ name: "Nossa Conta Premium Mensal - teste Sandbox", quantity: 1, value: 14.9, imageBase64 }],
  }),
  redirect: "error", signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error("Asaas Sandbox checkout creation failed (HTTP " + response.status + ")");
const data = await response.json();
if (typeof data?.id !== "string" || !/^[A-Za-z0-9_-]{10,100}$/.test(data.id)) {
  throw new Error("Asaas Sandbox returned an invalid checkout identifier");
}
console.log("NC_SANDBOX_CHECKOUT_URL https://sandbox.asaas.com/checkoutSession/show?" + new URLSearchParams({ id: data.id }));
