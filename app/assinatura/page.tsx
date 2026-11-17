import Image from "next/image";
import "./subscription.css";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { brl, plans, premiumFeatures } from "@/lib/plans";
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
      <div className="subscription-layout">
        <div className="subscription-content">
          <header className="subscription-heading">
            <span className="marketing-eyebrow">PREMIUM NOSSA CONTA</span>
            <h1>Mais clareza para<br />planejar juntos.</h1>
            <p>Escolha o período e organize as finanças do seu espaço compartilhado.</p>
          </header>

          {paidDate && (
            <p className="notice" role="status">
              Premium pago ativo até {new Date(paidDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
            </p>
          )}
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
                  <strong>{brl(option.total)}</strong>
                  <span className="subscription-plan-period">{option.period}</span>
                  {option.months > 1 && <span className="subscription-equivalent">Equivale a {brl(option.monthly)}/mês</span>}
                  {option.saving > 0 && <span className="subscription-saving">Economize {brl(option.saving)}</span>}
                </a>
              ))}
            </nav>
          </section>

          <section className="subscription-section" aria-label="Contratação">
            {paymentsAvailable && productionCheckoutPilotAllows(user.id) ? (
              <>
                {retorno === "success" && <p className="notice" role="status">Confira abaixo a confirmação do pagamento.</p>}
                {retorno === "cancel" && <p className="notice" role="status">Checkout cancelado.</p>}
                {retorno === "expired" && <p className="notice" role="status">O link do checkout expirou.</p>}
                {(!paidDate || (retorno === "success" && pedido)) && (
                  <ProductionCheckout key={pedido ?? plan.id} cycle={plan.id} order={retorno === "success" ? pedido : undefined} />
                )}
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

        <div className="subscription-story">
          <Image src="/images/planning-together.webp"
            alt="Casal planejando as finanças juntos em casa"
            width={1200} height={800} priority
            sizes="(max-width: 850px) 100vw, 40vw"
            className="subscription-photo" />
          <section className="subscription-benefits" aria-labelledby="subscription-benefits-title">
            <span className="marketing-eyebrow">PARA ORGANIZAR A VIDA EM COMUM</span>
            <h2 id="subscription-benefits-title">Um plano para<br />o espaço de vocês.</h2>
            <ul>{premiumFeatures.map((feature) => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul>
          </section>
        </div>
      </div>
    </MarketingFrame>
  );
}
