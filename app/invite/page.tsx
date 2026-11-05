import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import Setup from "@/components/setup";
import AcceptInvite from "./accept-invite";
export const dynamic = "force-dynamic";
export default async function Invite({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (!isConfigured()) return <Setup />;
  const { token } = await searchParams;
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Convite inválido.</h1>
          <p>Peça um novo link para quem criou o espaço.</p>
          <a href="/">Voltar ao início</a>
        </section>
      </main>
    );
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    redirect("/login?next=" + encodeURIComponent("/invite?token=" + token));
  return <AcceptInvite token={token} email={user.email || ""} />;
}
