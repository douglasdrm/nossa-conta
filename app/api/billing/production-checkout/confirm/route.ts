import { z } from "zod";
import { ApiError, authenticated, checkOrigin, failure } from "@/lib/api";
import { productionCheckoutEnabled } from "@/lib/production-checkout";
import { confirmationOrder, verifyInitialCheckoutPayment } from "@/lib/production-checkout-confirmation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const key = process.env.ASAAS_PRODUCTION_API_KEY;
    const token = process.env.NC_PRODUCTION_CHECKOUT_TOKEN;
    if (!productionCheckoutEnabled() || !key || !token || token.length < 32)
      throw new ApiError("A confirmação está indisponível.", 503);
    const { db, user } = await authenticated();
    if (user.is_anonymous || !user.email_confirmed_at)
      throw new ApiError("Confirme seu e-mail para continuar.", 403);
    const input = z.object({ order: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null));
    if (!input.success) throw new ApiError("Pedido inválido.", 400);
    const orderId = input.data.order;
    const { data, error } = await db.rpc("nc_production_checkout_confirmation_order", { p_token: token, p_order: orderId });
    if (error) throw new ApiError("Não foi possível consultar o pedido.", 503);
    const parsed = confirmationOrder.safeParse(data);
    if (!parsed.success) throw new ApiError("Pedido indisponível.", 404);

    const headers = { "Cache-Control": "no-store" };
    const order = parsed.data;
    const result = await verifyInitialCheckoutPayment(key, order).catch(() => null);
    if (!result) throw new ApiError("O Asaas ainda não respondeu à consulta. Tente novamente.", 503);
    if (result.status !== "verified") return Response.json(result, { headers });

    const { data: settled, error: settleError } = await db.rpc("nc_confirm_production_checkout_payment", {
      p_token: token, p_order: orderId, p_checkout: order.checkout_id, p_payment: result.paymentId,
      p_subscription: result.subscriptionId, p_amount: order.amount_cents,
      p_due_date: result.dueDate, p_status: result.providerStatus,
    });
    const response = z.object({
      status: z.enum(["confirmed", "manual_review", "unavailable"]),
      valid_until: z.string().optional(),
    }).safeParse(settled);
    if (settleError || !response.success || response.data.status === "unavailable")
      throw new ApiError("Não foi possível registrar a confirmação. Tente novamente.", 503);
    return Response.json(response.data, { headers });
  } catch (error) {
    return failure(error);
  }
}
