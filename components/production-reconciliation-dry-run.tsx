"use client";
import {useState} from "react";
import {
  previewProductionPaymentReconciliation,
  previewHouseholdPremiumRights,
  type VerifiedProviderCharge,
} from "@/lib/production-reconciliation-preview";

const expected={
  householdId:"familia-exemplo-A",subscriptionId:"sub_exemplo_012345",
  amountCents:1490,dueDate:"2027-01-13",cycle:"monthly" as const,
};
const sample:VerifiedProviderCharge={
  id:"pay_exemplo_012345",environment:"production",
  householdReference:expected.householdId,
  subscriptionId:expected.subscriptionId,amountCents:1490,
  dueDate:expected.dueDate,cycle:"monthly",
  status:"CONFIRMED",fetchedFromProvider:true,
};
type Scenario={name:string;result:"eligible"|"duplicate"|"rejected"|"manual_review";override:Partial<VerifiedProviderCharge>;prior?:string[]};
const cases:Scenario[]=[
  {name:"Pagamento verificado compatível",result:"eligible",override:{}},
  {name:"Pagamento duplicado",result:"duplicate",override:{},prior:[sample.id]},
  {name:"Pagamento de Sandbox",result:"rejected",override:{environment:"sandbox"}},
  {name:"Pagamento não verificado",result:"rejected",override:{fetchedFromProvider:false}},
  {name:"Outra família",result:"rejected",override:{householdReference:"familia-exemplo-B"}},
  {name:"Valor diferente",result:"rejected",override:{amountCents:3990}},
  {name:"Assinatura diferente",result:"rejected",override:{subscriptionId:"sub_outra_012345"}},
  {name:"Vencimento diferente",result:"rejected",override:{dueDate:"2027-02-13"}},
  {name:"Pagamento pendente",result:"rejected",override:{status:"PENDING"}},
  {name:"Estorno total",result:"manual_review",override:{status:"REFUNDED"}},
  {name:"Contestação",result:"manual_review",override:{status:"CHARGEBACK_REQUESTED"}},
];
export default function ProductionReconciliationDryRun(){
  const [results,setResults]=useState<{
    name:string;passed:boolean;outcome:string;reason:string;
  }[]|null>(null);
  const run=()=>{
    setResults(cases.map(item=>{
      const r=previewProductionPaymentReconciliation(expected,{...sample,...item.override},item.prior??[]);
      return {name:item.name,passed:r.outcome===item.result&&!r.wouldWrite&&!r.wouldGrantAccess,
        outcome:r.outcome,reason:r.reason};
    }));
  };
  const household = previewHouseholdPremiumRights({
    householdId:"familia-exemplo-B",now:"2026-11-16T12:00:00Z",
    courtesyUntil:"2027-01-31T00:00:00Z",
    paidThrough:"2027-01-13T14:00:00Z",
    paymentHouseholdId:"familia-exemplo-A",
    paymentVerified:true,paymentStatus:"CONFIRMED",
  });
  return <section className="sandbox-simulator" aria-label="Prévia de reconciliação de produção">
    <h4>Pagamentos reais · conferência de preparação</h4>
    <p><strong>Somente simulação com dados fictícios.</strong> Nenhuma credencial, pagamento ou conta real é consultada. Esta tela não habilita a cobrança de produção.</p>
    <button type="button" onClick={run}>Validar isolamento e reconciliação de produção</button>
    {results && <div role="status" className="sandbox-simulator-result">
      <p><strong>{results.every(r=>r.passed)?"Simulação aprovada":"Revisão necessária"}</strong> · {results.filter(r=>r.passed).length} de {results.length} cenários corretos.</p>
      {results.map(r=><p key={r.name}>{r.passed?"✓":"✗"} {r.name}: {r.outcome} ({r.reason}).</p>)}
      <p><strong>Outra família com cortesia:</strong> {household?.hypotheticalTier==="courtesy"?"cortesia preservada":"rever isolamento"}.
        {" "}Cobrança de outra família não gera direito pago: {household?.paidEvidenceAccepted?"Falhou":"confirmado"}.</p>
      <p>Escritas no banco: nenhuma. Acesso real: inalterado.</p>
    </div>}
    <small>Aprovar esta simulação não significa homologar a API ou webhook de produção, nem autoriza lançamento comercial.</small>
  </section>;
}
