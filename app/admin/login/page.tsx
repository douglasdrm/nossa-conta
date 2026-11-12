import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginForm from "@/app/login/login-form";
import { isConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import Setup from "@/components/setup";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Acesso administrativo",
  robots: { index: false, follow: false },
};
export default async function AdminLogin() {
  if (!isConfigured()) return <Setup />;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (user && !user.is_anonymous && user.email_confirmed_at) {
    const { data } = await db.rpc("nc_is_system_admin");
    if (data === true) redirect("/admin");
    return (
      <main className="auth-page">
        <section className="auth-card">
          <span className="tag">ADMINISTRAÇÃO DO NOSSA CONTA</span>
          <h1>Conta sem permissão administrativa.</h1>
          <p>
            A assinatura Premium é independente da administração. Entre com uma
            conta autorizada.
          </p>
          <form action="/auth/signout" method="post">
            <input type="hidden" name="next" value="/admin/login" />
            <button className="primary save">Sair e trocar de conta</button>
          </form>
          <a href="/">Voltar ao aplicativo</a>
        </section>
      </main>
    );
  }
  return (
    <Suspense fallback={<p>Carregando acesso administrativo…</p>}>
      <LoginForm administrative />
    </Suspense>
  );
}
