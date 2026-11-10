import { authenticated, checkOrigin, failure, ApiError } from "@/lib/api";
import { profileSchema } from "@/lib/profile";
export const dynamic = "force-dynamic";
export async function PATCH(r: Request) {
  try {
    checkOrigin(r);
    const { db } = await authenticated();
    const parsed = profileSchema.safeParse(await r.json());
    if (!parsed.success)
      throw new ApiError(
        "Informe seu nome e um nome de usuário com 3 a 30 letras sem acento, números ou sublinhado.",
        400,
      );
    const { error } = await db.rpc(
      parsed.data.color === undefined
        ? "nc_save_profile"
        : "nc_save_profile_color",
      {
        p_name: parsed.data.name,
        p_username: parsed.data.username || null,
        ...(parsed.data.color !== undefined && { p_color: parsed.data.color }),
      },
    );
    if (error)
      throw new ApiError(
        error.code === "23505"
          ? "Esse nome de usuário já está em uso. Escolha outro."
          : "Não foi possível salvar o perfil.",
        400,
      );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
