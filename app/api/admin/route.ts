import { authenticated, checkOrigin, failure, ApiError } from "@/lib/api";
import { adminMutationSchema } from "@/lib/commercial";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, user } = await authenticated();
    if (user.is_anonymous || !user.email_confirmed_at)
      throw new ApiError("Acesso restrito.", 403);
    const admin = await db.rpc("nc_is_system_admin");
    if (admin.error || admin.data !== true)
      throw new ApiError("Acesso restrito à administração.", 403);
    const parsed = adminMutationSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new ApiError("Confira os campos informados.", 400);
    const p = parsed.data;
    const result =
      p.action === "lead"
        ? await db.rpc("nc_admin_save_lead", {
            p_id: p.id,
            p_name: p.name,
            p_email: p.email,
            p_phone: p.phone,
            p_stage: p.stage,
            p_notes: p.notes,
            p_source: p.source,
          })
        : await db.rpc("nc_admin_courtesy", {
            p_household: p.household,
            p_until: p.until,
            p_reason: p.reason,
          });
    if (result.error)
      throw new ApiError(
        result.error.code === "23505"
          ? "Já existe um lead com esse e-mail."
          : "Não foi possível salvar. Confira os dados.",
        400,
      );
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
