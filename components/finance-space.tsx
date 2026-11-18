import AcquisitionCapture from "@/components/marketing/acquisition-capture";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import Setup from "@/components/setup";
import { myProfile } from "@/lib/my-profile";
import Dashboard, { type FinanceView } from "@/app/dashboard";
import { readAccountAccess } from "@/lib/access";
import Brand from "@/components/brand";
export default async function FinanceSpace({
  view = "overview",
  initialMonth,
  guest,
}: {
  view?: FinanceView;
  initialMonth?: string;
  guest?: React.ReactNode;
}) {
  if (!isConfigured()) return guest ?? <Setup />;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || user.is_anonymous || !user.email_confirmed_at) {
    if (guest) return guest;
    redirect(
      {
        overview: "/login",
        savings: "/login?next=/caixinhas",
        entries:
          "/login?next=" +
          encodeURIComponent(
            initialMonth ? `/lancamentos?mes=${initialMonth}` : "/lancamentos",
          ),
        categories: "/login?next=/categorias",
        cards: "/login?next=/cartoes",
        plan: "/login?next=/plano-do-mes",
        annual: "/login?next=/relatorio-anual",
      }[view],
    );
  }
  const { error } = await db.rpc("nc_ensure_household");
  if (error)
    throw new Error(
      "Não foi possível abrir o espaço da família. Verifique a configuração do banco.",
    );
  const profile = await myProfile(db, user);
  const access = await readAccountAccess(db);
  if (!access.can_access) return (
    <main className="auth-page"><section className="auth-card">
      <Brand />
      <h1>O compartilhamento está pausado.</h1>
      <p>Peça ao responsável pelo espaço para renovar o Premium. Os dados e os participantes continuam guardados e o acesso compartilhado será retomado com a renovação.</p>
      <a className="primary save" href="/profile">Meu perfil</a>
      <form action="/auth/signout" method="post"><button className="text-button">Sair</button></form>
    </section></main>
  );
  return (
    <>
      <AcquisitionCapture register />
      <Dashboard
        name={profile.name}
        photo={profile.photo}
        view={view}
        initialMonth={initialMonth}
        access={access}
      />
    </>
  );
}

