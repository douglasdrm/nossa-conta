import { z } from "zod";
import { plans, billingCycles, type BillingCycle } from "./plans";
export const checkoutSchema = z
  .object({ cycle: z.enum(billingCycles), method: z.enum(["card", "pix"]) })
  .strict();
export const billingOrigin = "https://nossaconta.unodev.com.br";
export function sandboxConfig() {
  if (
    process.env.ASAAS_ENVIRONMENT !== "sandbox" ||
    !process.env.ASAAS_API_KEY ||
    !process.env.ASAAS_WEBHOOK_TOKEN
  )
    throw new Error("Asaas Sandbox ainda não configurado.");
  return {
    key: process.env.ASAAS_API_KEY,
    token: process.env.ASAAS_WEBHOOK_TOKEN,
  };
}
export async function asaas<T>(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
): Promise<T> {
  const { key } = sandboxConfig();
  const response = await fetch("https://api-sandbox.asaas.com/v3" + path, {
    method,
    headers: {
      access_token: key,
      "Content-Type": "application/json",
      "User-Agent": "NossaConta/1.0",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  // Provider bodies may contain personal information. Never log or forward them.
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Chave do Asaas Sandbox inválida ou expirada."
        : "O Asaas não concluiu a operação. Tente novamente pelo painel.",
    );
  return response.json();
}

/**
 * Sandbox-only Asaas payment book: GET can create future payments.
 * Never call from automatic sync or on page load. The administrator must
 * authorize it explicitly after the linked subscription has been verified.
 * Only request JSON; do not collect/store PDFs with customer details.
 */
export async function generateSandboxPaymentBook(
  subscriptionId: string, dueDate: string,
): Promise<void> {
  if (!/^sub_[A-Za-z0-9_-]{6,100}$/.test(subscriptionId) ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dueDate))
    throw new Error("Assinatura ou vencimento inválido.");
  const { key } = sandboxConfig();
  const month = Number(dueDate.slice(5,7));
  const year = Number(dueDate.slice(0,4));
  const response = await fetch(
    "https://api-sandbox.asaas.com/v3/subscriptions/" +
      encodeURIComponent(subscriptionId) +
      "/paymentBook?month=" + month + "&year=" + year,
    { headers: {
      access_token: key,
      "Accept": "application/json",
      "User-Agent": "NossaConta/1.0",
    }, cache:"no-store", signal: AbortSignal.timeout(20000) }
  );
  if (!response.ok) throw new Error(
    "O Asaas não conseguiu antecipar a cobrança de teste. Nenhuma nova tentativa automática será feita."
  );
}

export function checkoutUrl(id: string) {
  if (!/^[a-zA-Z0-9_-]{10,100}$/.test(id))
    throw new Error("Identificador de checkout inválido.");
  return "https://sandbox.asaas.com/checkoutSession/show/" + id;
}
export function checkoutPayload(
  id: string,
  cycle: BillingCycle,
  method: "card" | "pix",
  image: string,
  now = new Date(),
) {
  const plan = plans.find((p) => p.id === cycle)!;
  const back = billingOrigin + "/assinatura?periodo=" + cycle;
  return {
    billingTypes: [method === "card" ? "CREDIT_CARD" : "PIX"],
    chargeTypes: [method === "card" ? "RECURRENT" : "DETACHED"],
    minutesToExpire: 60,
    externalReference: id,
    callback: {
      successUrl: back + "&retorno=success",
      cancelUrl: back + "&retorno=cancel",
      expiredUrl: back + "&retorno=expired",
    },
    items: [
      {
        name: "Nossa Conta " + plan.name,
        description: "Sandbox — teste sem cobrança real",
        quantity: 1,
        value: plan.total / 100,
        imageBase64: image,
      },
    ],
    ...(method === "card"
      ? {
          subscription: {
            cycle: {
              monthly: "MONTHLY",
              quarterly: "QUARTERLY",
              yearly: "YEARLY",
            }[cycle],
            nextDueDate: new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Sao_Paulo",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(now),
          },
        }
      : {}),
  };
}
export type ProviderCheckout = {
  id: string;
  status: string;
  externalReference?: string;
  items?: { value: number; quantity: number }[];
};
export function verifiedCheckoutStatus(
  checkout: ProviderCheckout,
  orderId: string,
  amount: number,
) {
  if (
    checkout.externalReference !== orderId ||
    !checkout.items?.length ||
    checkout.items.some(
      (i) =>
        !Number.isFinite(i.value) ||
        !Number.isInteger(i.quantity) ||
        i.quantity < 1,
    ) ||
    Math.round(
      checkout.items.reduce((s, i) => s + i.value * i.quantity, 0) * 100,
    ) !== amount
  )
    throw new Error("Checkout não corresponde ao pedido.");
  const status = (
    {
      ACTIVE: "pending",
      PAID: "paid",
      CANCELED: "canceled",
      EXPIRED: "expired",
    } as Record<string, string>
  )[checkout.status];
  if (!status) throw new Error("Status de checkout desconhecido.");
  return status;
}
