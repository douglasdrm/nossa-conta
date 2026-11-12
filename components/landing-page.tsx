import Image from "next/image";
import Pricing from "./marketing/pricing";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  CalendarRange,
  ChevronRight,
  CircleHelp,
  Heart,
  LayoutDashboard,
  PiggyBank,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import Brand from "./brand";
import "./landing-page.css";

const features = [
  {
    Icon: Users,
    title: "Uma casa, todo mundo junto",
    text: "Cada pessoa entra com a própria conta. Vocês acompanham o mesmo espaço e sabem quem pagou cada despesa.",
  },
  {
    Icon: CalendarRange,
    title: "O mês inteiro à vista",
    text: "Veja o que já entrou, o que foi pago e o que ainda está previsto. Organize contas recorrentes e compras parceladas.",
  },
  {
    Icon: BellRing,
    title: "Um radar para as contas",
    text: "Acompanhe vencimentos e avisos sobre o saldo. Com histórico suficiente, veja estimativas dos gastos habituais.",
  },
  {
    Icon: LayoutDashboard,
    title: "Entenda para onde vai",
    text: "Explore gastos por categoria e forma de pagamento. Toque em um total para conferir os lançamentos.",
  },
  {
    Icon: PiggyBank,
    title: "Um plano para cada sonho",
    text: "Organize metas nas Caixinhas e registre o que você já guardou. Dê forma aos próximos passos da casa.",
  },
  {
    Icon: SlidersHorizontal,
    title: "Um orçamento com a sua cara",
    text: "Escolha um perfil no Plano do mês e ajuste os percentuais de acordo com a realidade de vocês.",
  },
];

const questions = [
  [
    "Preciso informar o meu salário?",
    "Informar a renda é opcional. Ao cadastrar entradas recebidas e previstas, você passa a acompanhar também a previsão de saldo do mês.",
  ],
  [
    "Como compartilho com outra pessoa?",
    "Crie seu espaço e envie um convite pela área Compartilhar. A outra pessoa entra com a própria conta para registrar e acompanhar as finanças junto com você.",
  ],
  [
    "As Caixinhas guardam dinheiro?",
    "As Caixinhas são um guia para suas metas. Você registra valores guardados e planejados, enquanto o dinheiro continua onde você escolheu manter.",
  ],
  [
    "Dá para instalar no celular?",
    "Sim. O Nossa Conta pode ser adicionado à tela inicial como app web, inclusive no Android. Use o botão Instalar app disponível no site.",
  ],
  [
    "Quanto custa o Premium?",
    "A proposta é R$ 14,90 por mês, R$ 41,70 a cada três meses ou R$ 154,80 por ano (equivalente a R$ 12,90 por mês). A contratação está em preparação; nesta etapa não há cobrança e os recursos atuais continuam gratuitos.",
  ],
];

export default function LandingPage() {
  return (
    <div className="marketing">
      <header className="marketing-header">
        <a
          className="marketing-brand"
          href="/conheca"
          aria-label="Nossa Conta — apresentação"
        >
          <Brand />
        </a>
        <nav aria-label="Navegação da apresentação">
          <a href="/conheca#recursos">Recursos</a>
          <a href="/conheca#como-funciona">Como funciona</a>
          <a href="/planos">Planos</a>
        </nav>
        <a className="marketing-login" href="/login">
          Entrar <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </header>

      <main className="marketing-main">
        <section className="marketing-hero">
          <div className="marketing-hero-copy">
            <span className="marketing-eyebrow">
              <Heart size={15} aria-hidden="true" /> FINANÇAS PARA COMPARTILHAR
              A VIDA
            </span>
            <h1>
              Mais clareza nas contas.
              <br />
              <span>Mais planos juntos.</span>
            </h1>
            <p>
              Um app de controle financeiro para casais e famílias organizarem o
              dinheiro da casa, dividirem responsabilidades e abrir espaço para
              o que vocês querem viver.
            </p>
            <div className="marketing-actions">
              <a className="marketing-cta" href="/login?mode=signup">
                Começar gratuitamente{" "}
                <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="marketing-text-link" href="/conheca#como-funciona">
                Conhecer o Nossa Conta{" "}
                <ChevronRight size={16} aria-hidden="true" />
              </a>
            </div>
            <p className="marketing-hero-note">
              <ShieldCheck size={16} aria-hidden="true" /> Cada pessoa com sua
              conta. Um espaço para a casa.
            </p>
          </div>
          <div className="marketing-hero-visual">
            <Image
              className="marketing-couple-photo"
              src="/images/planning-together.webp"
              alt="Casal em casa olhando o celular e planejando o mês juntos"
              width={1200}
              height={800}
              priority
              sizes="(max-width: 650px) 100vw, 50vw"
            />
            <div
              className="marketing-preview"
              aria-label="Exemplo ilustrativo do painel financeiro"
            >
              <div className="marketing-preview-top">
                <span>
                  <Wallet size={17} aria-hidden="true" /> Nosso mês
                </span>
                <span>Exemplo ilustrativo</span>
              </div>
              <div className="marketing-preview-balance">
                <span>Saldo previsto</span>
                <strong>R$ 3.300,00</strong>
                <small>Depois das receitas e contas lançadas</small>
                <span className="marketing-preview-spark">
                  <Sparkles size={24} aria-hidden="true" />
                </span>
              </div>
              <div className="marketing-preview-totals">
                <div>
                  <ArrowDownLeft size={16} aria-hidden="true" />
                  <span>Entradas</span>
                  <strong>R$ 8.400,00</strong>
                </div>
                <div>
                  <ArrowUpRight size={16} aria-hidden="true" />
                  <span>Pagos + a pagar</span>
                  <strong>R$ 5.100,00</strong>
                </div>
              </div>
              <div className="marketing-preview-category">
                <span>
                  <i className="preview-dot-home" /> Moradia
                </span>
                <b>R$ 2.100,00</b>
              </div>
              <div className="marketing-preview-category">
                <span>
                  <i className="preview-dot-market" /> Mercado
                </span>
                <b>R$ 850,00</b>
              </div>
              <div className="marketing-preview-goal">
                <PiggyBank size={23} aria-hidden="true" />
                <div>
                  <strong>A próxima viagem</strong>
                  <span>
                    Um objetivo de vocês, uma Caixinha para acompanhar.
                  </span>
                  <div className="marketing-goal-track">
                    <i />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          className="marketing-features"
          id="recursos"
          aria-labelledby="features-title"
        >
          <div className="marketing-section-heading">
            <span className="marketing-eyebrow">
              O PRESENTE ORGANIZADO. O FUTURO MAIS PERTO.
            </span>
            <h2 id="features-title">
              O dinheiro faz parte da vida.
              <br />
              Cuidar dele pode ser mais simples.
            </h2>
            <p>
              Do cafezinho à conta da casa, vocês acompanham os detalhes e
              enxergam o mês por inteiro.
            </p>
          </div>
          <div className="marketing-feature-grid">
            {features.map(({ Icon, title, text }) => (
              <article key={title}>
                <span className="marketing-feature-icon">
                  <Icon size={23} aria-hidden="true" />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="marketing-personal"
          aria-labelledby="personal-title"
        >
          <Image
            src="/images/planning-your-month.webp"
            alt="Mulher organizando suas contas pelo celular em casa"
            width={1200}
            height={800}
            sizes="(max-width: 650px) 100vw, 50vw"
          />
          <div>
            <span className="marketing-eyebrow">
              NO SEU RITMO. DO SEU JEITO.
            </span>
            <h2 id="personal-title">Seu dinheiro, seus planos.</h2>
            <p>
              A vida fica melhor quando as contas fazem sentido. Comece
              organizando o seu mês e convide alguém para planejar junto quando
              quiser.
            </p>
            <a className="marketing-text-link" href="/login?mode=signup">
              Começar meu planejamento{" "}
              <ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section
          className="marketing-how"
          id="como-funciona"
          aria-labelledby="how-title"
        >
          <div className="marketing-section-heading">
            <span className="marketing-eyebrow">UM PASSO DE CADA VEZ</span>
            <h2 id="how-title">Começar cabe no seu dia.</h2>
          </div>
          <ol>
            {[
              [
                "Abra o espaço da casa",
                "Crie sua conta e convide quem vai organizar as finanças com você.",
              ],
              [
                "Anote o que entra e sai",
                "Registre receitas, despesas, quem pagou e a forma de pagamento.",
              ],
              [
                "Enxerguem o próximo passo",
                "Acompanhem o saldo previsto, os relatórios e as metas de vocês.",
              ],
            ].map(([title, text], index) => (
              <li key={title}>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <Pricing />

        <section className="marketing-faq" aria-labelledby="faq-title">
          <div className="marketing-section-heading">
            <span className="marketing-eyebrow">
              <CircleHelp size={16} aria-hidden="true" /> ANTES DE COMEÇAR
            </span>
            <h2 id="faq-title">Pode perguntar.</h2>
          </div>
          <div>
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="marketing-final">
          <div>
            <span className="marketing-eyebrow">VAMOS ORGANIZAR ESSE MÊS?</span>
            <h2>
              Os próximos planos
              <br />
              começam na nossa conta.
            </h2>
          </div>
          <a className="marketing-cta" href="/login?mode=signup">
            Começar gratuitamente <ArrowRight size={18} aria-hidden="true" />
          </a>
        </section>
      </main>
      <footer className="marketing-footer">
        <a href="/conheca" aria-label="Nossa Conta — apresentação">
          <Brand />
        </a>
        <p>Um passo de cada vez, juntos.</p>
        <a href="/financas-para-casal">Finanças para casal</a>
        <a href="/controle-financeiro-familiar">Controle familiar</a>
        <a href="/guias/organizar-contas-do-casal">Guia do casal</a>
        <span>Desenvolvido pela UNODEV</span>
        <a href="/login">Acessar minha conta</a>
      </footer>
    </div>
  );
}
