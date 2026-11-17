import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { brl, plans } from "@/lib/plans";
import MarketingFrame from "@/components/marketing/frame";
import SubscriptionInterest from "@/components/subscription-interest";
import ProductionCheckout from "@/components/production-checkout";
import { productionCheckoutEnabled, productionCheckoutPilotAllows } from "@/lib/production-checkout";
export const dynamic = "force-dynamic";
export default async function Subscription({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; retorno?: string; pedido?: string }>;
}) {
  const { periodo, retorno, pedido } = await searchParams;
  const paymentsAvailable = productionCheckoutEnabled();
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
  const paidUntil = paymentsAvailable ? await db.rpc("nc_production_paid_premium_until") : null;
  if (paidUntil?.error) throw new Error("Não foi possível consultar o Premium pago.");
  const paidDate = typeof paidUntil?.data === "string" ? paidUntil.data : null;
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
        {paidDate && (
          <p className="notice">
            <strong>Premium pago ativo para este espaço compartilhado</strong> até{" "}
            {new Date(paidDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
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
      <section className="seo-copy">
        {paymentsAvailable && productionCheckoutPilotAllows(user.id) ? (
          <>
            <h2>{paidDate ? "Pagamento do Premium" : "Contratar Premium"}</h2>
            {retorno === "success" && (
              <p role="status">Checkout concluído. A confirmação do pagamento depende do Asaas.</p>
            )}
            {retorno === "cancel" && <p role="status">Checkout cancelado.</p>}
            {retorno === "expired" && <p role="status">O link do checkout expirou.</p>}
            {(!paidDate || (retorno === "success" && pedido)) && (
              <ProductionCheckout key={pedido ?? plan.id} cycle={plan.id} order={retorno === "success" ? pedido : undefined} />
            )}
          </>
        ) : (
          <>
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
          </>
        )}
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
