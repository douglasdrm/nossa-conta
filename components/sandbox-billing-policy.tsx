"use client";

import { useState } from "react";
import {
  simulateSandboxBillingPolicy,
  type BillingPolicyScenario,
} from "@/lib/sandbox-billing-policy";

const scenarios: {value:BillingPolicyScenario;label:string}[] = [
  {value:"pending",label:"Pagamento pendente"},
  {value:"declined",label:"Pagamento recusado"},
  {value:"canceled",label:"Cancelamento voluntário"},
  {value:"refunded",label:"Estorno total"},
  {value:"disputed",label:"Contestação"},
];
const offsets = [
  {value:-1,label:"Um dia antes"},
  {value:0,label:"No vencimento"},
  {value:1,label:"Um dia depois"},
  {value:3,label:"Três dias depois"},
  {value:4,label:"Quatro dias depois"},
];
const states = {
  paid_period:"Dentro do prazo pago",
  grace:"Tolerância hipotética",
  unpaid:"Sem benefício pago após o prazo",
  manual_review:"Revisão administrativa obrigatória",
} as const;
function brDate(yyyyMMdd:string) {
  const [y,m,d]=yyyyMMdd.split("-");
  return [d,m,y].join("/");
}
export default function SandboxBillingPolicy({validUntil}:{validUntil:string}) {
  const [scenario,setScenario] = useState<BillingPolicyScenario>("pending");
  const [offset,setOffset] = useState(1);
  const result = simulateSandboxBillingPolicy({
    validUntil,scenario,dayOffset:offset,
  });
  return (
    <section className="sandbox-simulator" aria-label="Simulação da política de inadimplência">
      <h4>Simular regras de inadimplência e cancelamento</h4>
      <p><strong>Proposta em avaliação:</strong> até 3 dias corridos de tolerância para cobrança pendente ou recusada, contados após o prazo pago. Cancelamento preserva o prazo já pago; estorno e contestação exigem revisão.</p>
      <p>Simulação exclusivamente local, sem alterar o Asaas, o banco de dados, a validade ou qualquer acesso Premium real.</p>
      <div className="sandbox-policy-controls">
        <label>Cenário
          <select value={scenario} onChange={e=>setScenario(e.target.value as BillingPolicyScenario)}>
            {scenarios.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label>Data hipotética para avaliação
          <select value={offset} onChange={e=>setOffset(Number(e.target.value))}>
            {offsets.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {result && (
        <div className="sandbox-simulator-result" aria-live="polite">
          <p><strong>Data avaliada:</strong> {brDate(result.referenceDate)}</p>
          <p><strong>Fim do prazo pago:</strong> {brDate(result.validUntilDate)}</p>
          <p><strong>Fim da tolerância proposta:</strong> {brDate(result.graceThrough)}</p>
          <p><strong>Resultado:</strong> {states[result.state]}</p>
          <p><strong>Nova renovação concedida:</strong> Não</p>
          <p><strong>Revisão manual:</strong> {result.manualReviewRequired ? "Obrigatória" : "Não exigida por este cenário"}</p>
          <p><strong>Novas cobranças automáticas na política proposta:</strong> {result.futureAutomaticRenewals ? "Permitidas" : "Bloqueadas"}</p>
          <p>{result.description}</p>
        </div>
      )}
      <small>Os resultados representam uma política proposta, não uma decisão de acesso vigente. Nada é salvo. Recarregar a página restaura as opções iniciais.</small>
    </section>
  );
}
