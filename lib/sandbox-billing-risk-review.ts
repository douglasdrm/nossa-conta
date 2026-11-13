import type { AsaasCharge } from "./asaas-renewal-reconciliation";

export type SandboxRiskCategory =
  | "refund_or_dispute" | "subscription_stopped" | "payment_problem"
  | "pending_next_cycle" | "healthy" | "review_unknown";

export type SandboxRiskReview = {
  category: SandboxRiskCategory;
  notes: string[];
  nextDueDate: string;
  nextPaymentStatus: string | null;
  reversedPaymentDueDates: string[];
  settledPaymentDueDates: string[];
  refundRequiresManualReview: boolean;
  futureChargesExpected: boolean;
  simulatedValidityUnaffected: true;
};

const refunded = new Set(["REFUNDED","PARTIALLY_REFUNDED","CHARGEBACK_REQUESTED","CHARGEBACK_DISPUTE","AWAITING_CHARGEBACK_REVERSAL"]);
const failed = new Set(["OVERDUE","CREDIT_CARD_CAPTURE_REFUSED","DUNNING_REQUESTED"]);
const settled = new Set(["CONFIRMED","RECEIVED"]);
const pending = new Set(["PENDING","AWAITING_RISK_ANALYSIS","IN_ANALYSIS"]);

export function reviewSandboxBillingRisks(
  expected: { subscriptionId:string; amount:number; validUntil:string },
  subscription: {id:string;status:string;nextDueDate?:string|null},
  payments: AsaasCharge[],
): SandboxRiskReview {
  const due = new Intl.DateTimeFormat("en-CA", {
    timeZone:"America/Sao_Paulo", year:"numeric",month:"2-digit",day:"2-digit"
  }).format(new Date(expected.validUntil));
  if (subscription.id !== expected.subscriptionId) throw new Error("Assinatura não corresponde ao pedido.");
  const matched = payments.filter(p =>
    p.subscription === expected.subscriptionId &&
    Number.isFinite(p.value) && Math.round(p.value*100) === expected.amount &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate));
  const next = matched.filter(p=>p.dueDate===due);
  const reverse = matched.filter(p=>refunded.has(p.status));
  const settledCharges=matched.filter(p=>settled.has(p.status));
  const stopped = ["INACTIVE","DELETED","CANCELED","CANCELLED","EXPIRED"].includes(subscription.status);
  const unknown = !["ACTIVE","INACTIVE","DELETED","CANCELED","CANCELLED","EXPIRED"].includes(subscription.status);
  const failure = next.some(p=>failed.has(p.status));
  const waiting = next.some(p=>pending.has(p.status));
  const notes:string[]=[];
  if (reverse.length) notes.push("Estorno ou contestação identificado. Exige revisão administrativa; nenhuma validade será retirada automaticamente.");
  if (stopped) notes.push("Assinatura interrompida no Asaas. Preservar o prazo pago e revisar novas cobranças.");
  if (failure) notes.push("Pagamento do próximo período com falha ou atraso. Não conceder novo período sem confirmação.");
  if (waiting) notes.push("Próxima cobrança pendente. Não prorrogar a validade antes da confirmação.");
  if (unknown) notes.push("Status de assinatura desconhecido. Conferência manual necessária.");
  if (!notes.length) notes.push("Nenhum indício de risco nos status consultados. Isso não garante ausência de eventos futuros.");
  const category:SandboxRiskCategory = reverse.length ? "refund_or_dispute" :
    stopped ? "subscription_stopped" : failure ? "payment_problem" :
    unknown ? "review_unknown" : waiting ? "pending_next_cycle" : "healthy";
  return {
    category,notes,nextDueDate:due,nextPaymentStatus:next[0]?.status ?? null,
    reversedPaymentDueDates:[...new Set(reverse.map(p=>p.dueDate))].sort(),
    settledPaymentDueDates:[...new Set(settledCharges.map(p=>p.dueDate))].sort(),
    refundRequiresManualReview:reverse.length>0,
    futureChargesExpected:subscription.status==="ACTIVE",
    simulatedValidityUnaffected:true,
  };
}
