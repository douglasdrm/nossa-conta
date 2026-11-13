import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { brl, plans } from "@/lib/plans";
import MarketingFrame from "@/components/marketing/frame";
import BillingSandbox from "@/components/billing-sandbox";
import SubscriptionInterest from "@/components/subscription-interest";
export const dynamic = "force-dynamic";
export default async function Subscription({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { periodo } = await searchParams;
  const plan = plans.find((p) => p.id === periodo) || plans[2];
  if (!isConfigured()) redirect("/planos");
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || user.is_anonymous || !user.email_confirmed_at)
    redirect(
      "/login?mode=signup&next=" +
        encodeURIComponent("/assinatura?periodo=" + plan.id),
    );
  const { error: ensureError } = await db.rpc("nc_ensure_household");
  if (ensureError) throw new Error("Não foi possível abrir sua assinatura.");
  const { data: member } = await db
    .from("nc_household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .single();
  const { data: courtesy, error } = await db
    .from("nc_subscriptions")
    .select("valid_until")
    .eq("household_id", member?.household_id)
    .gt("valid_until", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error("Não foi possível consultar sua assinatura.");
  const { data: isAdmin } = await db.rpc("nc_is_system_admin");
  const { data: sandboxStatus, error: sandboxError } = await db.rpc("nc_sandbox_premium_status");
  if (sandboxError) throw new Error("Não foi possível consultar a simulação de assinatura.");
  const sandbox = sandboxStatus as { state?: string; cycle?: string; valid_until?: string } | null;
  return (
    <MarketingFrame>
      <section className="seo-intro">
        <span className="marketing-eyebrow">MINHA ASSINATURA</span>
        <h1>Premium {plan.name.toLowerCase()}</h1>
        <p>
          <strong>
            {brl(plan.total)} {plan.period}
          </strong>{" "}
          · equivalente a {brl(plan.monthly)}/mês.
        </p>
        {sandbox?.state === "active" && sandbox.valid_until && (
          <p className="notice">
            <strong>Premium simulado ativo para este espaço compartilhado</strong> até{" "}
            {new Date(sandbox.valid_until).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
            {" "}Somente teste do Asaas: não libera recursos pagos nem gera cobrança real.
          </p>
        )}
        {courtesy && (
          <p className="notice">
            Você tem uma cortesia Premium válida até{" "}
            {new Date(courtesy.valid_until).toLocaleDateString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}
            .
          </p>
        )}
      </section>
      {isAdmin === true && (
        <section className="seo-copy">
          <BillingSandbox cycle={plan.id} />
        </section>
      )}
      <section className="seo-copy">
        <h2>Contratação em preparação</h2>
        <p>
          Seu espaço continua com os recursos atuais gratuitos. Registre seu
          interesse neste período sem informar cartão e sem assumir compromisso
          de pagamento.
        </p>
        <p>
          O interesse será vinculado à sua conta para organizar o atendimento.
          Isso não ativa uma assinatura paga.
        </p>
        <SubscriptionInterest cycle={plan.id} />
        <div className="seo-links">
          {plans.map((p) => (
            <a key={p.id} href={"/assinatura?periodo=" + p.id}>
              {p.name} · {brl(p.monthly)}/mês
            </a>
          ))}
        </div>
        <a href="/">Voltar ao meu espaço</a>
      </section>
    </MarketingFrame>
  );
}
