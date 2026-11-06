import { authenticated, checkOrigin, failure, ApiError } from "@/lib/api";
import { avatarLimit } from "@/lib/profile";
import { prepareAvatar } from "@/lib/avatar";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const { db, user } = await authenticated();
    if (Number(r.headers.get("content-length")) > avatarLimit + 100000)
      throw new ApiError("Use uma foto de até 3 MB.", 413);
    const file = (await r.formData()).get("photo");
    if (!(file instanceof File) || file.size > avatarLimit)
      throw new ApiError("Escolha uma foto JPG, PNG ou WebP de até 3 MB.", 400);
    let photo: Buffer;
    try {
      photo = await prepareAvatar(Buffer.from(await file.arrayBuffer()));
    } catch {
      throw new ApiError(
        "Imagem inválida. Use uma foto JPG, PNG ou WebP de até 3 MB.",
        400,
      );
    }
    const { data: previous, error: readError } = await db
      .from("nc_user_profiles")
      .select("avatar_path")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw readError;
    const path = `${user.id}/${crypto.randomUUID()}.webp`;
    const { error: uploadError } = await db.storage
      .from("nc-avatars")
      .upload(path, photo, { contentType: "image/webp", upsert: false });
    if (uploadError)
      throw new ApiError(
        "Não foi possível enviar a foto. Tente novamente.",
        400,
      );
    const { error } = await db.rpc("nc_set_avatar", { p_path: path });
    if (error) {
      await db.storage.from("nc-avatars").remove([path]);
      throw new ApiError("Não foi possível salvar a foto.", 400);
    }
    if (previous?.avatar_path)
      await db.storage.from("nc-avatars").remove([previous.avatar_path]);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(r: Request) {
  try {
    checkOrigin(r);
    const { db, user } = await authenticated();
    const { data: previous, error: readError } = await db
      .from("nc_user_profiles")
      .select("avatar_path")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw readError;
    const { error } = await db.rpc("nc_set_avatar", { p_path: null });
    if (error) throw error;
    if (previous?.avatar_path)
      await db.storage.from("nc-avatars").remove([previous.avatar_path]);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
