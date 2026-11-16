/**
 * Dry-run blueprint for a future provider-verified production reconciliation.
 * This module does not make provider requests, issue database writes, or grant
 * access. No API endpoint accepts these fixtures as payment evidence.
 */
export type ProductionPaymentStatus =
  | "PENDING" | "CONFIRMED" | "RECEIVED" | "REFUNDED"
  | "PARTIALLY_REFUNDED" | "CHARGEBACK_REQUESTED" | "OVERDUE"
  | "CANCELED" | "CREDIT_CARD_CAPTURE_REFUSED";

export type ExpectedProductionCharge = {
  householdId: string;
  subscriptionId: string;
  amountCents: number;
  dueDate: string;
  cycle: "monthly" | "quarterly" | "yearly";
};
export type VerifiedProviderCharge = {
  id: string;
  environment: "production" | "sandbox";
  householdReference: string;
  subscriptionId: string;
  amountCents: number;
  dueDate: string;
  cycle: string;
  status: ProductionPaymentStatus;
  fetchedFromProvider: boolean;
};
export type ProductionReconciliationPreview = {
  outcome: "eligible" | "duplicate" | "manual_review" | "rejected";
  reason: string;
  wouldWrite: false;
  wouldGrantAccess: false;
};

const dateRe=/^\d{4}-\d{2}-\d{2}$/;
function isDate(value: string): boolean {
  if(!dateRe.test(value)) return false;
  const d=new Date(value+"T00:00:00.000Z");
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}

export function previewProductionPaymentReconciliation(
  expected: ExpectedProductionCharge,
  provider: VerifiedProviderCharge,
  previouslyProcessedIds: readonly string[],
): ProductionReconciliationPreview {
  const rejected=(reason:string):ProductionReconciliationPreview=>({
    outcome:"rejected",reason,wouldWrite:false,wouldGrantAccess:false,
  });
  if (!provider.fetchedFromProvider) return rejected("provider_not_verified");
  if (provider.environment !== "production") return rejected("sandbox_payment_forbidden");
  if (!/^pay_[A-Za-z0-9_-]{3,120}$/.test(provider.id)) return rejected("payment_id_invalid");
  if (!/^sub_[A-Za-z0-9_-]{6,100}$/.test(expected.subscriptionId) ||
      provider.subscriptionId !== expected.subscriptionId)
    return rejected("subscription_mismatch");
  if (!expected.householdId || provider.householdReference !== expected.householdId)
    return rejected("household_mismatch");
  if (!Number.isSafeInteger(expected.amountCents) || expected.amountCents <= 0 ||
      provider.amountCents !== expected.amountCents)
    return rejected("amount_mismatch");
  if (!isDate(expected.dueDate) || provider.dueDate !== expected.dueDate ||
      !isDate(provider.dueDate))
    return rejected("due_date_mismatch");
  if (provider.cycle !== expected.cycle) return rejected("cycle_mismatch");
  if (previouslyProcessedIds.includes(provider.id)) return {
    outcome:"duplicate",reason:"payment_already_processed",
    wouldWrite:false,wouldGrantAccess:false,
  };
  if (["REFUNDED","PARTIALLY_REFUNDED","CHARGEBACK_REQUESTED"].includes(provider.status))
    return {outcome:"manual_review",reason:"reversal_requires_manual_review",
      wouldWrite:false,wouldGrantAccess:false};
  if (!["CONFIRMED","RECEIVED"].includes(provider.status))
    return rejected("payment_not_settled");
  return {outcome:"eligible",reason:"eligible_for_future_server_only_processing",
    wouldWrite:false,wouldGrantAccess:false};
}

export type HouseholdShadowInput = {
  householdId:string;
  now:string;
  courtesyUntil:string | null;
  paidThrough:string | null;
  paymentHouseholdId:string | null;
  paymentVerified:boolean;
  paymentStatus:ProductionPaymentStatus | null;
};
export type HouseholdShadowPreview = {
  hypotheticalTier:"courtesy" | "paid" | "free" | "manual_review";
  courtesyActive:boolean;
  paidEvidenceAccepted:boolean;
  actualAccess:"unchanged_free_for_all";
};

export function previewHouseholdPremiumRights(input:HouseholdShadowInput):HouseholdShadowPreview|null {
  const now=Date.parse(input.now);
  if (!Number.isFinite(now)||!input.householdId) return null;
  const courtesyTime=input.courtesyUntil?Date.parse(input.courtesyUntil):NaN;
  const paidTime=input.paidThrough?Date.parse(input.paidThrough):NaN;
  const courtesyActive=Number.isFinite(courtesyTime)&&courtesyTime>now;
  const status=input.paymentStatus;
  const paymentMatches=input.paymentHouseholdId===input.householdId;
  const reversed=status==="REFUNDED"||status==="PARTIALLY_REFUNDED"||
    status==="CHARGEBACK_REQUESTED";
  const paidEvidenceAccepted=paymentMatches && input.paymentVerified &&
    Number.isFinite(paidTime)&&paidTime>now && (status==="CONFIRMED"||status==="RECEIVED");
  const hypotheticalTier=courtesyActive?"courtesy":
    reversed&&paymentMatches?"manual_review":paidEvidenceAccepted?"paid":"free";
  return {hypotheticalTier,courtesyActive,paidEvidenceAccepted,
    actualAccess:"unchanged_free_for_all"};
}
