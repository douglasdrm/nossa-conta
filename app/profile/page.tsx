import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { myProfile } from "@/lib/my-profile";
import ProfileEditor from "@/components/profile-editor";
export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  if (!isConfigured()) redirect("/");
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || user.is_anonymous || !user.email_confirmed_at)
    redirect("/login?next=/profile");
  const { error } = await db.rpc("nc_ensure_household");
  if (error) throw new Error("Não foi possível abrir o perfil.");
  const profile = await myProfile(db, user);
  return (
    <ProfileEditor
      {...profile}
      email={user.email || ""}
      pendingEmail={user.new_email || ""}
    />
  );
}
