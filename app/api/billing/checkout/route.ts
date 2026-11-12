import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ApiError, checkOrigin, failure } from "@/lib/api";
import {
  asaas,
  checkoutPayload,
  checkoutSchema,
  checkoutUrl,
} from "@/lib/asaas";
import { billingAdmin, recordResult } from "@/lib/billing-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await billingAdmin();
    const parsed = checkoutSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new ApiError("Escolha um plano e uma forma de pagamento.", 400);
    const { data: hooks } = await asaas<{
      data: { url: string; enabled: boolean; interrupted: boolean }[];
    }>("/webhooks?limit=100");
    if (
      !hooks.some(
        (h) =>
          h.url === "https://nossaconta.unodev.com.br/api/billing/webhook" &&
          h.enabled &&
          !h.interrupted,
      )
    )
      throw new ApiError(
        "Conecte o Asaas de testes no painel antes de abrir o checkout.",
        409,
      );
    const { data, error } = await db.rpc("nc_billing_reserve", {
      p_cycle: parsed.data.cycle,
      p_method: parsed.data.method,
    });
    if (error)
      throw new ApiError(
        "Já há um checkout em andamento. Consulte Cobranças no painel ou aguarde a expiração.",
        409,
      );
    if (data.checkout_id)
      return Response.json({ url: checkoutUrl(data.checkout_id) });
    if (data.reused)
      throw new ApiError(
        "O checkout está sendo criado. Aguarde um momento.",
        409,
      );
    const svg = await readFile(
      path.join(process.cwd(), "public/brand/symbol-white.svg"),
    );
    const image = (
      await sharp(svg)
        .resize(160, 160)
        .flatten({ background: "#185540" })
        .png()
        .toBuffer()
    ).toString("base64");
    // A timeout may have created a checkout remotely: keep the reservation until expiry.
    const result = await asaas<{ id: string }>(
      "/checkouts",
      checkoutPayload(data.id, parsed.data.cycle, parsed.data.method, image),
    );
    const url = checkoutUrl(result.id);
    await recordResult(data.id, result.id, "pending", undefined, data.amount);
    return Response.json({ url });
  } catch (error) {
    return failure(error);
  }
}
