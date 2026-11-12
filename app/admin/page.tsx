import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import AdminPanel from "@/components/admin-panel";
import type { AdminData } from "@/lib/commercial";
export const dynamic = "force-dynamic";
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; tab?: string }>;
}) {
  if (!isConfigured()) redirect("/admin/login");
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || user.is_anonymous || !user.email_confirmed_at)
    redirect("/admin/login");
  const { data: isAdmin, error: permissionError } =
    await db.rpc("nc_is_system_admin");
  if (permissionError || isAdmin !== true)
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Acesso restrito</h1>
          <p>Esta área é exclusiva para administradores do Nossa Conta.</p>
          <a href="/">Voltar ao meu espaço</a>
        </section>
      </main>
    );
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(100000, Number.parseInt(params.p || "1", 10) || 1),
  );
  const search = (params.q || "").slice(0, 120);
  const { data, error } = await db.rpc("nc_admin_data", {
    p_search: search,
    p_page: page,
  });
  if (error) throw new Error("Não foi possível carregar a administração.");
  return (
    <AdminPanel
      data={data as AdminData}
      page={page}
      search={search}
      tab={params.tab || "overview"}
    />
  );
}
