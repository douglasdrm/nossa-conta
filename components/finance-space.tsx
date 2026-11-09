import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import Setup from "@/components/setup";
import { myProfile } from "@/lib/my-profile";
import Dashboard from "@/app/dashboard";
export default async function FinanceSpace({
  savingsView = false,
}: {
  savingsView?: boolean;
}) {
  if (!isConfigured()) return <Setup />;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || user.is_anonymous || !user.email_confirmed_at)
    redirect(savingsView ? "/login?next=/caixinhas" : "/login");
  const { error } = await db.rpc("nc_ensure_household");
  if (error)
    throw new Error(
      "Não foi possível abrir o espaço da família. Verifique a configuração do banco.",
    );
  const profile = await myProfile(db, user);
  return (
    <Dashboard
      name={profile.name}
      photo={profile.photo}
      savingsView={savingsView}
    />
  );
}
