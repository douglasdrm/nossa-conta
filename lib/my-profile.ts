import type { ProfileColor } from "./visual-colors";
import type { SupabaseClient, User } from "@supabase/supabase-js";
export async function myProfile(db: SupabaseClient, user: User) {
  const { data, error } = await db
    .from("nc_user_profiles")
    .select("display_name,username,avatar_path,color")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error)
    throw new Error("Não foi possível carregar seu perfil. Tente novamente.");
  const fallback =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : user.email?.split("@")[0] || "Você";
  let photo = "";
  if (data?.avatar_path) {
    const { data: signed } = await db.storage
      .from("nc-avatars")
      .createSignedUrl(data.avatar_path, 3600);
    photo = signed?.signedUrl || "";
  }
  return {
    name: data?.display_name || fallback.trim().slice(0, 60),
    username: data?.username || "",
    photo,
    color: (data?.color ?? null) as ProfileColor | null,
  };
}
