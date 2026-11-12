import { Check } from "lucide-react";
import { brl, plans, premiumFeatures } from "@/lib/plans";
export default function Pricing() {
  return (
    <section
      className="marketing-plans"
      id="planos"
      aria-labelledby="plans-title"
    >
      <div className="marketing-section-heading">
        <span className="marketing-eyebrow">
          UMA ASSINATURA PARA ORGANIZAR JUNTOS
        </span>
        <h2 id="plans-title">Seu mês organizado. No seu ritmo.</h2>
        <p>
          Premium mensal, trimestral ou anual. Escolha o período que combina com
          vocês.
        </p>
      </div>
      <div className="marketing-plan-grid">
        {plans.map((plan) => (
          <article
            key={plan.id}
            className={`marketing-plan ${plan.id === "yearly" ? "marketing-plan-live" : ""}`}
          >
            <span className="marketing-plan-label">
              {plan.id === "yearly" ? "MELHOR VALOR MENSAL" : "PREMIUM"}
            </span>
            <h3>{plan.name}</h3>
            <strong className="marketing-plan-price">
              {brl(plan.monthly)}
              <span className="price-unit">/mês</span>
            </strong>
            <p>
              <b>{brl(plan.total)}</b> {plan.period}.
            </p>
            <small>
              {plan.saving
                ? `Economize ${brl(plan.saving)} por ${plan.months === 12 ? "ano" : "trimestre"} em relação ao mensal.`
                : "Pagamento por período mensal."}
            </small>
            <ul>
              {premiumFeatures.map((feature) => (
                <li key={feature}>
                  <Check size={16} aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
            <a
              className="marketing-cta"
              href={`/assinatura?periodo=${plan.id}`}
            >
              Tenho interesse no {plan.name.toLowerCase()}
            </a>
          </article>
        ))}
      </div>
      <p className="marketing-plan-footnote">
        Contratação em preparação. Você já pode criar sua conta gratuitamente e
        registrar seu interesse. Nenhuma cobrança será feita nesta etapa. Os
        recursos atuais continuam disponíveis.
      </p>
    </section>
  );
}
