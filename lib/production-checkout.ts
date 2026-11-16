import { z } from "zod";
import { checkoutPayload } from "./asaas";
import { plans, type BillingCycle } from "./plans";

export const productionCheckoutEnabled = () =>
  process.env.NC_PRODUCTION_CHECKOUT_ENABLED === "true";

const providerCheckout = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/) });

export function productionCheckoutUrl(id: string) {
  const checkout = providerCheckout.parse({ id });
  return "https://asaas.com/checkoutSession/show?" + new URLSearchParams({ id: checkout.id });
}

export function productionCheckoutPayload(
  id: string, cycle: BillingCycle, method: "card" | "pix", amount: number, image: string,
) {
  const plan = plans.find((entry) => entry.id === cycle);
  if (!plan || amount !== plan.total) throw new Error("Valor da reserva divergente do catálogo.");
  const payload = checkoutPayload(id, cycle, method, image);
  return {
    ...payload,
    items: payload.items.map((item) => ({
      ...item, description: "Premium Nossa Conta",
    })),
  };
}

export async function requestProductionCheckout(
  key: string, payload: ReturnType<typeof productionCheckoutPayload>,
  send: typeof fetch = fetch,
) {
  const response = await send("https://api.asaas.com/v3/checkouts", {
    method: "POST",
    headers: { access_token: key, "Content-Type": "application/json", "User-Agent": "NossaConta/1.0" },
    body: JSON.stringify(payload),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("O Asaas não concluiu a criação do checkout.");
  const checkout = providerCheckout.safeParse(await response.json());
  if (!checkout.success) throw new Error("O Asaas retornou um checkout inválido.");
  return checkout.data.id;
}
