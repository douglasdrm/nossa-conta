"use client";
import {useState} from "react";
import {inspectProductionWebhookAgainstProvider, matchesProductionWebhookToken}
  from "@/lib/production-webhook-verification";

type Check={label:string;passed:boolean;result:string};
const expected={householdId:"familia_ficticia_A",subscriptionId:"sub_exemplo_123456",
  amountCents:1490,dueDate:"2027-01-13",cycle:"monthly" as const};
const webhook={id:"evt_exemplo_2027",event:"PAYMENT_CONFIRMED",
  payment:{id:"pay_exemplo_123456",status:"CONFIRMED"}};
const provider={id:"pay_exemplo_123456",subscription:"sub_exemplo_123456",
  externalReference:"familia_ficticia_A",value:14.9,
  dueDate:"2027-01-13",status:"CONFIRMED"};
export default function ProductionWebhookDryRun(){
  const [checks,setChecks]=useState<Check[]|null>(null);
  const run=()=>{
    const scenarios=[
      {label:"Confirmação verificada pelo provedor",status:"settled",
        event:webhook,payment:provider,auth:true},
      {label:"Webhook sem autenticação",status:"invalid",
        event:webhook,payment:provider,auth:false},
      {label:"Pagamento diferente do notificado",status:"invalid",
        event:webhook,payment:{...provider,id:"pay_outro_123456"},auth:true},
      {label:"Família divergente",status:"invalid",
        event:webhook,payment:{...provider,externalReference:"familia_B"},auth:true},
      {label:"Valor divergente",status:"invalid",
        event:webhook,payment:{...provider,value:39.90},auth:true},
      {label:"Notificação antiga: provedor pendente",status:"pending",
        event:webhook,payment:{...provider,status:"PENDING"},auth:true},
      {label:"Estorno confirmado no provedor",status:"reversal",
        event:webhook,payment:{...provider,status:"REFUNDED"},auth:true},
      {label:"Contestação confirmada no provedor",status:"reversal",
        event:webhook,payment:{...provider,status:"CHARGEBACK_REQUESTED"},auth:true},
    ] as const;
    const results:Check[]=scenarios.map(s=>{
      const r=inspectProductionWebhookAgainstProvider(s.event,s.payment,expected,s.auth);
      return {label:s.label,passed:r.category===s.status&&!r.writesPerformed&&!r.premiumGranted,
        result:r.reason};
    });
    const secret="FictitiousSeparateWebhookSecretNotForProduction2026";
    results.push({label:"Token de webhook independente",passed:
      matchesProductionWebhookToken(secret,secret)&&
      !matchesProductionWebhookToken(secret,"token-invalido"),
      result:"confere credencial fictícia"});
    setChecks(results);
  };
  return <section className="sandbox-simulator" aria-label="Homologação local de eventos de produção">
    <h4>Webhook de produção · verificação preparatória</h4>
    <p>Teste local com notificações e respostas do provedor totalmente fictícias. O webhook real não está configurado e nenhuma chamada à API de produção é realizada.</p>
    <button type="button" onClick={run}>Validar segurança do webhook de produção</button>
    {checks && <div role="status" aria-live="polite" className="sandbox-simulator-result">
      <p><strong>{checks.every(c=>c.passed)?"Simulação aprovada":"Falhas a revisar"}</strong>
        {" · "}{checks.filter(c=>c.passed).length} de {checks.length} verificações corretas.</p>
      {checks.map(c=><p key={c.label}>{c.passed?"✓":"✗"} {c.label}: {c.result}.</p>)}
      <p><strong>Gravações realizadas:</strong> 0. <strong>Premium real concedido:</strong> Não.</p>
    </div>}
    <small>Essa aprovação não homologa a entrega real, a persistência de eventos, a consulta autenticada ao Asaas nem a habilitação de cobrança.</small>
  </section>;
}
