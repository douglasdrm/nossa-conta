import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import Setup from "@/components/setup";
import { myProfile } from "@/lib/my-profile";
import Dashboard, { type FinanceView } from "@/app/dashboard";
export default async function FinanceSpace({
  view = "overview",
  initialMonth,
}: {
  view?: FinanceView;
  initialMonth?: string;
}) {
  if (!isConfigured()) return <Setup />;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || user.is_anonymous || !user.email_confirmed_at)
    redirect(
      {
        overview: "/login",
        savings: "/login?next=/caixinhas",
        entries:
          "/login?next=" +
          encodeURIComponent(
            initialMonth ? `/lancamentos?mes=${initialMonth}` : "/lancamentos",
          ),
        plan: "/login?next=/plano-do-mes",
        annual: "/login?next=/relatorio-anual",
      }[view],
    );
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
      view={view}
      initialMonth={initialMonth}
    />
  );
}
