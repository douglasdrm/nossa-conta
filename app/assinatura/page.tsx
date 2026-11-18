import { z } from "zod";
import SubscriptionBenefits from "@/components/subscription-benefits";
import "./subscription.css";
import { readAccountAccess } from "@/lib/access";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { brl, plans, billingCycles } from "@/lib/plans";
import MarketingFrame from "@/components/marketing/frame";
import SubscriptionInterest from "@/components/subscription-interest";
import ProductionCheckout from "@/components/production-checkout";
import { productionCheckoutEnabled, productionCheckoutPilotAllows } from "@/lib/production-checkout";
export const dynamic = "force-dynamic";
const paidSubscriptionSchema = z.object({
  cycle: z.enum(billingCycles), amount_cents: z.number().int().positive(),
  method: z.enum(["pix", "card"]), valid_until: z.string().datetime({ offset: true }),
});
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
  if (!user || user.is_anonymous || !user.email_confirmed_at) {
    const destination = new URLSearchParams({ periodo: plan.id });
    if (retorno && ["success", "cancel", "expired"].includes(retorno)) destination.set("retorno", retorno);
    if (pedido && z.string().uuid().safeParse(pedido).success) destination.set("pedido", pedido);
    redirect("/login?next=" + encodeURIComponent("/assinatura?" + destination));
  }
  const { error: ensureError } = await db.rpc("nc_ensure_household");
  if (ensureError) throw new Error("Não foi possível abrir sua assinatura.");
  const access = await readAccountAccess(db);
  if (!access.can_access) return <MarketingFrame signedIn><section className="seo-intro"><h1>O compartilhamento está pausado.</h1><p>Peça ao responsável pelo espaço para renovar o Premium. Seus dados continuam guardados.</p><a href="/profile">Meu perfil</a></section></MarketingFrame>;
  const { data: offer, error: offerError } = await db.rpc("nc_pilot_offer_amount");
  if (offerError) throw new Error("Não foi possível consultar as condições do piloto.");
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
  const { data: paidData, error: paidError } = await db.rpc("nc_paid_subscription_summary");
  if (paidError) throw new Error("Não foi possível consultar sua assinatura paga.");
  const paid = paidData ? paidSubscriptionSchema.parse(paidData) : null;
  if (paid) {
    const subscribedPlan = plans.find((option) => option.id === paid.cycle)!;
    const validUntil = new Date(paid.valid_until).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return (
      <MarketingFrame signedIn>
        <div className="subscription-layout">
          <div className="subscription-content">
            <header className="subscription-heading">
              <span className="marketing-eyebrow">MINHA ASSINATURA</span>
              <h1>Seu Premium<br />está ativo.</h1>
              <p>Seu pagamento foi confirmado. Os recursos completos estão disponíveis para o seu espaço e seus convidados.</p>
            </header>
            <section className="subscription-summary" aria-labelledby="subscription-summary-title">
              <h2 id="subscription-summary-title">Premium {subscribedPlan.name.toLowerCase()}</h2>
              <dl>
                <div><dt>Situação</dt><dd>Ativa</dd></div>
                <div><dt>Último pagamento confirmado</dt><dd>{brl(paid.amount_cents)}</dd></div>
                <div><dt>Forma de pagamento</dt><dd>{paid.method === "pix" ? "Pix · pagamento por período" : "Cartão de crédito"}</dd></div>
                <div><dt>Acesso Premium até</dt><dd>{validUntil}</dd></div>
              </dl>
              <a className="subscription-submit" href="/">Ir para meu espaço <span aria-hidden="true">→</span></a>
            </section>
          </div>
          <SubscriptionBenefits />
        </div>
      </MarketingFrame>
    );
  }
  if (retorno === "success" && pedido && z.string().uuid().safeParse(pedido).success) {
    return (
      <MarketingFrame signedIn>
        <div className="subscription-layout">
          <div className="subscription-content">
            <header className="subscription-heading">
              <span className="marketing-eyebrow">ACOMPANHAR PAGAMENTO</span>
              <h1>Conferindo<br />seu pagamento.</h1>
              <p>A confirmação será registrada assim que o Asaas comunicar o recebimento.</p>
            </header>
            <section className="subscription-section" aria-label="Consultar confirmação">
              <ProductionCheckout cycle={plan.id} order={pedido} />
            </section>
            <a className="subscription-back" href="/">← Voltar ao meu espaço</a>
          </div>
          <SubscriptionBenefits />
        </div>
      </MarketingFrame>
    );
  }
  return (
    <MarketingFrame signedIn>
      <div className="subscription-layout">
        <div className="subscription-content">
          <header className="subscription-heading">
            <span className="marketing-eyebrow">PREMIUM NOSSA CONTA</span>
            <h1>Mais clareza para<br />planejar juntos.</h1>
            <p>Escolha o período e organize as finanças do seu espaço compartilhado.</p>
          </header>

          {access.kind === "trial" && access.trial_until && <p className="notice">Premium grátis até {new Date(access.trial_until).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Ao terminar, seu espaço passa ao modo gratuito individual.</p>}
          {offer === 500 && <p className="notice">Teste de compra desta conta — mensal por R$ 5,00 via Pix, com pagamento único.</p>}
          {courtesy && (
            <p className="notice">
              Sua cortesia Premium é válida até {new Date(courtesy.valid_until).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
            </p>
          )}

          <section className="subscription-section" aria-labelledby="subscription-period">
            <h2 id="subscription-period">Escolha seu plano</h2>
            <nav className="subscription-plans" aria-label="Período da assinatura">
              {plans.map((option) => (
                <a className={"subscription-plan" + (option.id === plan.id ? " is-selected" : "")}
                  key={option.id} href={"/assinatura?periodo=" + option.id}
                  aria-current={option.id === plan.id ? "page" : undefined}>
                  <span className="subscription-plan-name">{option.name}<span className="subscription-plan-radio" aria-hidden="true" /></span>
                  <strong>{brl(offer === 500 && option.id === "monthly" ? 500 : option.total)}</strong>
                  <span className="subscription-plan-period">{offer === 500 && option.id === "monthly" ? "Pix do piloto · 1 mês" : option.period}</span>
                  {option.months > 1 && <span className="subscription-equivalent">Equivale a {brl(option.monthly)}/mês</span>}
                  {option.saving > 0 && <span className="subscription-saving">Economize {brl(option.saving)}</span>}
                </a>
              ))}
            </nav>
          </section>

          <section className="subscription-section" aria-label="Contratação">
            {paymentsAvailable && (productionCheckoutPilotAllows(user.id) || offer === 500) ? (
              <>
                {retorno === "success" && <p className="notice" role="status">Confira abaixo a confirmação do pagamento.</p>}
                {retorno === "cancel" && <p className="notice" role="status">Checkout cancelado.</p>}
                {retorno === "expired" && <p className="notice" role="status">O link do checkout expirou.</p>}
                <ProductionCheckout key={plan.id} cycle={plan.id} offerAmount={offer === 500 && plan.id === "monthly" ? 500 : undefined} />
              </>
            ) : (
              <div className="subscription-interest">
                <h2>Receba novidades sobre a contratação</h2>
                <p>Registre seu interesse no plano {plan.name.toLowerCase()}. Avisaremos quando a contratação estiver disponível para sua conta.</p>
                <SubscriptionInterest cycle={plan.id} />
              </div>
            )}
          </section>
          <a className="subscription-back" href="/">← Voltar ao meu espaço</a>
        </div>

        <SubscriptionBenefits />
      </div>
    </MarketingFrame>
  );
}

