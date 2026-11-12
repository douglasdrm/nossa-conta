import MarketingFrame from "@/components/marketing/frame";
import Pricing from "@/components/marketing/pricing";
import { publicMetadata } from "@/lib/marketing/seo";
export const metadata = publicMetadata(
  "Planos e preços | Nossa Conta",
  "Conheça os planos do Nossa Conta: mensal de R$ 14,90, trimestral de R$ 39,90 e anual de R$ 119,90. Uma assinatura para organizar juntos.",
  "/planos",
);
export default function PlansPage() {
  return (
    <MarketingFrame>
      <section className="seo-intro">
        <span className="marketing-eyebrow">PLANOS DO NOSSA CONTA</span>
        <h1>
          Mais clareza nas contas.
          <br />
          <span>Uma assinatura para compartilhar.</span>
        </h1>
        <p>
          Organize o mês com quem divide a vida com você. Compare os períodos e
          os valores totais antes de escolher.
        </p>
      </section>
      <Pricing />
      <section className="seo-copy">
        <h2>Os dois precisam assinar?</h2>
        <p>
          Não. A proposta do Premium é uma assinatura por espaço compartilhado.
          As pessoas convidadas entram com a própria conta.
        </p>
        <h2>Já posso pagar?</h2>
        <p>
          A contratação está em preparação. Você pode registrar seu interesse,
          sem pagamento ou compromisso. Não pedimos dados de cartão nesta etapa.
        </p>
        <h2>Como funciona o anual?</h2>
        <p>
          O valor é R$ 119,90 por ano, equivalente a R$ 9,99 por mês. A
          economia é de R$ 58,90 em comparação com 12 mensalidades de R$ 14,90.
        </p>
      </section>
    </MarketingFrame>
  );
}
