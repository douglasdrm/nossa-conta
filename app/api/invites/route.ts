import { authenticated, checkOrigin, failure, ApiError } from "@/lib/api";
import { inviteSchema } from "@/lib/validation";
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const { db } = await authenticated();
    const input = inviteSchema.safeParse(await r.json());
    if (!input.success) throw new ApiError("Informe um e-mail válido.", 400);
    const { data, error } = await db.rpc("create_household_invite", {
      p_email: input.data.email,
    });
    if (error)
      throw new ApiError(
        "Somente o criador do espaço pode convidar. Verifique também se já há muitos convites pendentes.",
        403,
      );
    return Response.json(
      { token: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function GET() {
  try {
    const { db } = await authenticated();
    const { data, error } = await db
      .from("household_invites")
      .select("id,email,expires_at,accepted_at,revoked_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(r: Request) {
  try {
    checkOrigin(r);
    const { db } = await authenticated();
    const { id } = await r.json();
    if (typeof id !== "string") throw new ApiError("Convite inválido.", 400);
    const { error } = await db.rpc("revoke_household_invite", { p_id: id });
    if (error) throw new ApiError("Não foi possível revogar o convite.", 403);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
