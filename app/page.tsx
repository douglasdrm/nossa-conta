import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import Setup from "@/components/setup";
import Dashboard from "./dashboard";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!isConfigured()) return <Setup />;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || user.is_anonymous || !user.email_confirmed_at)
    redirect("/login");
  const { error } = await db.rpc("nc_ensure_household");
  if (error)
    throw new Error(
      "Não foi possível abrir o espaço da família. Verifique a configuração do banco.",
    );
  const displayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim().slice(0, 60)
      : "";
  return (
    <Dashboard name={displayName || user.email?.split("@")[0] || "Você"} />
  );
}
