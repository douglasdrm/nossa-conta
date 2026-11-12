import Image from "next/image";
import MarketingFrame from "./frame";
import Pricing from "./pricing";
export default function Audience({ family = false }: { family?: boolean }) {
  return (
    <MarketingFrame>
      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <span className="marketing-eyebrow">
            {family
              ? "CONTROLE FINANCEIRO FAMILIAR"
              : "APP DE FINANÇAS PARA CASAL"}
          </span>
          <h1>
            {family ? "As contas da casa." : "As contas de vocês."}
            <br />
            <span>Os planos juntos.</span>
          </h1>
          <p>
            {family
              ? "Organize receitas, despesas e vencimentos da família em um espaço compartilhado. Saiba quem pagou e o que ainda está previsto no mês."
              : "Cada pessoa com seu acesso, os gastos em um só espaço. Organize receitas, despesas e parcelas do casal e acompanhem o mês juntos."}
          </p>
          <div className="seo-actions">
            <a className="marketing-cta" href="/login?mode=signup">
              Criar minha conta grátis
            </a>
            <a href="/planos">Conhecer os planos</a>
          </div>
          <small>
            Recursos atuais gratuitos. Contratação Premium em preparação.
          </small>
        </div>
        <Image
          src="/images/planning-together.webp"
          alt="Casal planejando as contas da casa pelo celular"
          width={1200}
          height={800}
          className="marketing-couple-photo"
          priority
          sizes="(max-width:650px) 100vw,50vw"
        />
      </section>
      <section className="seo-copy">
        <h2>
          {family
            ? "Quem pagou a internet? E o mercado?"
            : "Vocês sabem o que já foi pago e o que ainda falta?"}
        </h2>
        <p>
          Registre quem é responsável pela despesa e quem fez o pagamento. Uma
          conta pode estar prevista sem ser marcada como paga: a confirmação
          ajuda a acompanhar o que já aconteceu e o que ainda precisa de
          atenção.
        </p>
        <h2>Compras parceladas e gastos que se repetem</h2>
        <p>
          Cadastre as parcelas de uma compra e acompanhe os próximos meses. Para
          contas como aluguel e internet, use as recorrências e ajuste o valor
          quando precisar.
        </p>
        <h2>Um acesso para cada pessoa</h2>
        <p>
          Crie seu espaço, envie o convite e acompanhem as mesmas informações
          com contas individuais. O Nossa Conta organiza os registros; ele não é
          uma conta bancária e não movimenta dinheiro.
        </p>
        <h2>Como começar</h2>
        <ol>
          <li>Crie sua conta e abra o espaço da casa.</li>
          <li>
            Registre receitas, despesas e parcelas. Informar o salário é
            opcional.
          </li>
          <li>Convide quem vai participar e acompanhem o saldo previsto.</li>
        </ol>
        <div className="seo-links">
          <a href="/guias/organizar-contas-do-casal">
            Como organizar as contas do casal
          </a>
          <a href="/guias/controlar-compras-parceladas">
            Como controlar compras parceladas
          </a>
          <a href="/guias/organizar-contas-fixas-e-variaveis">
            Contas fixas e variáveis
          </a>
        </div>
        <h2>Precisa instalar?</h2>
        <p>
          Você pode usar no navegador do celular ou do computador. No celular,
          também pode adicionar o Nossa Conta à tela inicial como app web.
        </p>
      </section>
      <Pricing />
    </MarketingFrame>
  );
}
