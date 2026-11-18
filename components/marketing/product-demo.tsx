"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, MousePointer2, Pause, Play, Plus, Users, Wallet } from "lucide-react";
import "./product-demo.css";

const steps = [
  { title: "Anote uma despesa", text: "Informe o valor, a categoria e quem pagou. Cada conta encontra seu lugar." },
  { title: "Veja o mês ganhar forma", text: "Acompanhe entradas, despesas e saldo previsto em um só lugar." },
  { title: "Organizem juntos", text: "No Premium, convide quem divide as contas com você. Cada pessoa usa a própria conta." },
];

export default function ProductDemo() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReducedMotion(media.matches); if (media.matches) setPlaying(false); };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!playing || reducedMotion) return;
    const timer = window.setTimeout(() => {
      if (step === steps.length - 1) setPlaying(false);
      else setStep(step + 1);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [playing, reducedMotion, step]);
  return (
    <section className="product-demo" aria-labelledby="demo-title">
      <div className="product-demo-copy">
        <span className="marketing-eyebrow">DO PRIMEIRO REGISTRO AO PLANO DO MÊS</span>
        <h2 id="demo-title">Poucos cliques.<br />Mais clareza no dia a dia.</h2>
        <p>Veja uma prévia de como organizar as contas. Sem cadastro para conhecer.</p>
        <ol className="product-demo-steps" aria-label="Etapas da demonstração">
          {steps.map((item, index) => <li key={item.title}>
            <button type="button" aria-current={step === index ? "step" : undefined} aria-controls="demo-screen" onClick={() => { setStep(index); setPlaying(false); }}>
              <span className="product-demo-number">0{index + 1}</span><span><strong>{item.title}</strong><small>{item.text}</small></span>
            </button>
          </li>)}
        </ol>
        {!reducedMotion && <button className="product-demo-play" type="button" onClick={() => { if (!playing) setStep(0); setPlaying(!playing); }}>
          {playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
          {playing ? "Pausar demonstração" : "Ver demonstração animada"}
        </button>}
        <small className="product-demo-disclaimer">Prévia ilustrativa com dados fictícios. Os botões acima mudam a cena.</small>
      </div>
      <div className="product-demo-window" id="demo-screen" role="region" aria-label={`Prévia ilustrativa: ${steps[step].title}`}>
        <div className="product-demo-bar"><span><Wallet size={18} aria-hidden="true" /> Nossa casa</span><span>DEMONSTRAÇÃO</span></div>
        <div className={`product-demo-scene${playing && !reducedMotion ? " is-playing" : ""}`} key={step}>
          {step === 0 ? <>
            <div className="product-demo-screen-title"><h3>Nova despesa</h3><Plus size={20} aria-hidden="true" /></div>
            <div className="product-demo-field"><span>Descrição</span><strong>Compras da semana</strong></div>
            <div className="product-demo-field"><span>Valor</span><strong>R$ 180,00</strong></div>
            <div className="product-demo-pair"><div className="product-demo-field"><span>Categoria</span><strong>Mercado</strong></div><div className="product-demo-field"><span>Quem pagou</span><strong>Alex</strong></div></div>
            <div className="product-demo-action"><Check size={17} aria-hidden="true" /> Salvar despesa</div>
          </> : step === 1 ? <>
            <div className="product-demo-screen-title"><h3>Resumo do mês</h3><span>Novembro</span></div>
            <div className="product-demo-balance"><span>Saldo previsto</span><strong>R$ 1.820,00</strong><small>Depois das receitas e despesas previstas</small></div>
            <div className="product-demo-pair product-demo-totals"><div><span>Entradas</span><strong>R$ 5.000,00</strong></div><div><span>Despesas</span><strong>R$ 3.180,00</strong></div></div>
            <div className="product-demo-entry"><span><strong>Compras da semana</strong><small>Mercado · Alex pagou</small></span><strong>R$ 180,00</strong></div>
            <div className="product-demo-saved"><Check size={16} aria-hidden="true" /> Despesa incluída no resumo</div>
          </> : <>
            <div className="product-demo-screen-title"><h3>Compartilhar o espaço</h3><Users size={21} aria-hidden="true" /></div>
            <p className="product-demo-sharing-note">Uma assinatura Premium para o espaço, com duas, três ou mais pessoas.</p>
            {[['A', 'Alex', 'Responsável'], ['B', 'Bia', 'Participante'], ['C', 'Cris', 'Participante']].map(([initial, name, role]) => <div className="product-demo-member" key={name}><span>{initial}</span><strong>{name}</strong><small>{role}</small></div>)}
            <div className="product-demo-action"><Plus size={17} aria-hidden="true" /> Convidar pessoa</div>
            <p className="product-demo-sharing-note">Os participantes acompanham os lançamentos deste espaço.</p>
          </>}
          {playing && !reducedMotion && <MousePointer2 className="product-demo-cursor" size={30} aria-hidden="true" />}
        </div>
        <div className="product-demo-bottom"><span>Exemplo {step + 1} de 3</span><button type="button" onClick={() => { setStep((step + 1) % steps.length); setPlaying(false); }}>Próxima cena <ArrowRight size={15} aria-hidden="true" /></button></div>
      </div>
    </section>
  );
}
