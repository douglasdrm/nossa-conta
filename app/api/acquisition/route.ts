import { authenticated, checkOrigin, failure, ApiError } from "@/lib/api";
import { acquisitionSchema } from "@/lib/commercial";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, user } = await authenticated();
    if (user.is_anonymous || !user.email_confirmed_at)
      throw new ApiError("Confirme seu cadastro para continuar.", 403);
    const parsed = acquisitionSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("Dados de origem inválidos.", 400);
    const p = parsed.data;
    const { error } = await db.rpc("nc_capture_lead", {
      p_source: p.source,
      p_medium: p.medium,
      p_campaign: p.campaign,
      p_landing: p.landing,
      p_cycle: p.cycle ?? null,
    });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
