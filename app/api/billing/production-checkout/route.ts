import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { ApiError, authenticated, checkOrigin, failure } from "@/lib/api";
import { checkoutSchema } from "@/lib/asaas";
import {
  productionCheckoutEnabled, productionCheckoutPayload, productionCheckoutUrl,
  requestProductionCheckout,
} from "@/lib/production-checkout";

export const runtime = "nodejs";

const reservation = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"), id: z.string().uuid(), checkout_id: z.string().nullable(),
    amount_cents: z.number().int().positive(), reused: z.boolean(),
  }),
  z.object({ status: z.enum(["unavailable", "forbidden", "invalid", "already_subscribed", "other_checkout"]) }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const key = process.env.ASAAS_PRODUCTION_API_KEY;
    const token = process.env.NC_PRODUCTION_CHECKOUT_TOKEN;
    if (!productionCheckoutEnabled() || !key || !token || token.length < 32) {
      throw new ApiError("A contratação ainda está indisponível.", 503);
    }
    const { db, user } = await authenticated();
    if (user.is_anonymous || !user.email_confirmed_at) {
      throw new ApiError("Confirme seu e-mail para contratar o Premium.", 403);
    }
    const input = checkoutSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new ApiError("Escolha um plano e uma forma de pagamento.", 400);
    const { cycle, method } = input.data;
    const { data, error } = await db.rpc("nc_reserve_production_checkout", {
      p_token: token, p_cycle: cycle, p_method: method,
    });
    const parsed = reservation.safeParse(data);
    if (error || !parsed.success) throw new ApiError("Não foi possível iniciar a contratação.", 503);
    const order = parsed.data;
    if (order.status !== "ready") {
      switch (order.status) {
        case "forbidden": throw new ApiError("Somente o responsável pelo espaço pode contratar.", 403);
        case "already_subscribed": throw new ApiError("Seu espaço já tem uma assinatura ou pagamento ativo.", 409);
        case "other_checkout": throw new ApiError("Já existe um checkout para este espaço. Aguarde a expiração.", 409);
        case "invalid": throw new ApiError("Plano ou forma de pagamento inválidos.", 400);
        default: throw new ApiError("A contratação ainda está indisponível.", 503);
      }
    }
    if (order.checkout_id) return Response.json({ url: productionCheckoutUrl(order.checkout_id) });
    if (order.reused) throw new ApiError("Já existe uma tentativa em andamento. Aguarde a conclusão ou expiração.", 409);

    const svg = await readFile(path.join(process.cwd(), "public/brand/symbol-white.svg"));
    const image = (await sharp(svg).resize(160, 160).flatten({ background: "#185540" }).png().toBuffer()).toString("base64");
    const id = await requestProductionCheckout(key, productionCheckoutPayload(order.id, cycle, method, order.amount_cents, image));
    const { data: saved, error: saveError } = await db.rpc("nc_attach_production_checkout", {
      p_token: token, p_order: order.id, p_checkout: id,
    });
    if (saveError || saved !== true) throw new ApiError("Não foi possível confirmar o link do checkout.", 503);
    return Response.json({ url: productionCheckoutUrl(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
