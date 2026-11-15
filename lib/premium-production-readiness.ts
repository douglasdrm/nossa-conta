/**
 * Production Premium launch checklist — intentionally advisory only.
 *
 * None of these flags grants access, enables a payment provider, creates
 * subscriptions or modifies the existing courtesy system. Release is blocked
 * until each production capability is implemented and independently audited.
 */
export type ProductionReadinessChecks = {
  sandboxRenewalVerified: boolean;
  courtesyIsolationPreserved: boolean;
  productionCheckoutConfigured: boolean;
  productionWebhookVerified: boolean;
  productionPaymentLedger: boolean;
  householdEntitlementResolver: boolean;
  refundDisputeHandling: boolean;
  authorizationGatesTested: boolean;
  explicitLaunchApproved: boolean;
};
export type ProductionReadinessItem = {
  key: keyof ProductionReadinessChecks;
  label: string;
  passed: boolean;
  required: true;
};
export type ProductionReadinessReport = {
  ready: boolean;
  accessPolicy: "free_for_all_unchanged";
  realBillingEnabled: false;
  realPremiumEnforced: false;
  passed: number;
  total: number;
  checks: ProductionReadinessItem[];
};

const checklist: {key:keyof ProductionReadinessChecks; label:string}[] = [
  {key:"sandboxRenewalVerified",label:"Renovação e idempotência testadas no Sandbox"},
  {key:"courtesyIsolationPreserved",label:"Cortesias isoladas da cobrança e preservadas"},
  {key:"productionCheckoutConfigured",label:"Checkout de produção separado e validado"},
  {key:"productionWebhookVerified",label:"Webhook de produção com autenticação e reconciliação"},
  {key:"productionPaymentLedger",label:"Registro de pagamentos reais idempotente por cobrança"},
  {key:"householdEntitlementResolver",label:"Autorização Premium real por espaço familiar"},
  {key:"refundDisputeHandling",label:"Regras de estorno, disputa e inadimplência homologadas"},
  {key:"authorizationGatesTested",label:"Portões de acesso Premium testados sem afetar funções gratuitas"},
  {key:"explicitLaunchApproved",label:"Aprovação explícita e revisão final de lançamento"},
];

/**
 * Diagnostic only: even all checks passing cannot switch on real billing.
 * A distinct, reviewed implementation is necessary for launch.
 */
export function evaluatePremiumProductionReadiness(
  checks: ProductionReadinessChecks,
): ProductionReadinessReport {
  const items: ProductionReadinessItem[] = checklist.map(({key,label})=>({
    key,label,passed:checks[key] === true,required:true,
  }));
  const passed = items.filter(i=>i.passed).length;
  return {
    ready: passed === items.length,
    accessPolicy:"free_for_all_unchanged",
    realBillingEnabled:false,
    realPremiumEnforced:false,
    passed,total:items.length,checks:items,
  };
}

export type ShadowPremiumEvidence = {
  environment: "sandbox" | "production";
  householdMatches: boolean;
  providerVerified: boolean;
  paymentStatus: "CONFIRMED" | "RECEIVED" | "PENDING" | "REFUNDED" | "CHARGEBACK_REQUESTED";
  paidUntil: string;
};
export type ShadowPremiumDecision = {
  hypotheticalPaidPeriod: boolean;
  courtesyActive: boolean;
  requiresManualReview: boolean;
  realAccessChanged: false;
  reason: "courtesy" | "verified_production_payment" | "sandbox_ignored" |
    "payment_not_confirmed" | "manual_review_required" | "expired" | "no_evidence";
};

/**
 * Independent hypothetical decision; NEVER used for authorization.
 * This cannot convert Sandbox payments to paid rights. A courtesy can
 * coexist with invalid/expired payment evidence without being revoked.
 */
export function previewShadowPremiumDecision(input: {
  now: string;
  courtesyValidUntil?: string | null;
  evidence?: ShadowPremiumEvidence | null;
}): ShadowPremiumDecision | null {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return null;
  const courtesy = input.courtesyValidUntil ? Date.parse(input.courtesyValidUntil) : NaN;
  const courtesyActive = Number.isFinite(courtesy) && courtesy > now;
  const evidence = input.evidence;
  const base = {courtesyActive,realAccessChanged:false as const};
  if (!evidence) return {
    ...base,hypotheticalPaidPeriod:false,requiresManualReview:false,
    reason:courtesyActive?"courtesy":"no_evidence",
  };
  if (evidence.environment !== "production") return {
    ...base,hypotheticalPaidPeriod:false,requiresManualReview:false,
    reason:courtesyActive?"courtesy":"sandbox_ignored",
  };
  const disputed = evidence.paymentStatus==="REFUNDED" ||
    evidence.paymentStatus==="CHARGEBACK_REQUESTED";
  if (disputed) return {
    ...base,hypotheticalPaidPeriod:false,requiresManualReview:true,
    reason:"manual_review_required",
  };
  const paidUntil=Date.parse(evidence.paidUntil);
  const valid = Number.isFinite(paidUntil) && paidUntil>now;
  const confirmed= evidence.paymentStatus==="CONFIRMED" ||
    evidence.paymentStatus==="RECEIVED";
  const hypotheticalPaidPeriod= evidence.householdMatches &&
    evidence.providerVerified && confirmed && valid;
  const reason:ShadowPremiumDecision["reason"] = hypotheticalPaidPeriod ?
    "verified_production_payment" : courtesyActive ? "courtesy" :
    !confirmed || !evidence.providerVerified || !evidence.householdMatches ?
      "payment_not_confirmed" : "expired";
  return {...base,hypotheticalPaidPeriod,requiresManualReview:false,reason};
}
