export type BillingPolicyScenario = "pending" | "declined" | "canceled" | "refunded" | "disputed";
export type BillingPolicyState = "paid_period" | "grace" | "unpaid" | "manual_review";
export type BillingPolicyInput = {
  validUntil: string;
  scenario: BillingPolicyScenario;
  dayOffset: number;
};
export type BillingPolicyResult = {
  scenario: BillingPolicyScenario;
  state: BillingPolicyState;
  referenceDate: string;
  validUntilDate: string;
  graceThrough: string;
  newPeriodGranted: false;
  realPremiumAffected: false;
  shouldAttemptCollection: boolean;
  manualReviewRequired: boolean;
  futureAutomaticRenewals: boolean;
  description: string;
};

const scenarios = new Set<BillingPolicyScenario>(["pending","declined","canceled","refunded","disputed"]);
const DAY_MS = 86_400_000;

function localDate(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(d);
}

function plusCalendarDays(yyyyMMdd: string, days: number): string {
  const date = new Date(yyyyMMdd + "T00:00:00.000Z");
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0,10);
}

/**
 * Hypothetical billing policy for display only.
 * Three whole Sao Paulo calendar days *after* the stored paid-through date.
 * No DB writes, Asaas calls, access control, or automatic refunds.
 * Cancellation and reversals never inherit a grace period.
 */
export function simulateSandboxBillingPolicy({
  validUntil, scenario, dayOffset,
}: BillingPolicyInput): BillingPolicyResult | null {
  if (!scenarios.has(scenario) || !Number.isInteger(dayOffset) ||
      dayOffset < -30 || dayOffset > 365) return null;
  const due = localDate(validUntil);
  if (!due) return null;
  const referenceDate = plusCalendarDays(due,dayOffset);
  const graceThrough = plusCalendarDays(due,3);
  const inPaidPeriod = dayOffset <= 0;
  const paymentFailure = scenario === "pending" || scenario === "declined";
  const manualReviewRequired = scenario === "refunded" || scenario === "disputed";
  const futureAutomaticRenewals = paymentFailure;
  const state: BillingPolicyState = manualReviewRequired ? "manual_review" :
    inPaidPeriod ? "paid_period" :
    paymentFailure && dayOffset <= 3 ? "grace" : "unpaid";
  const description = manualReviewRequired
    ? scenario === "refunded"
      ? "Estorno: revisão administrativa obrigatória. Não revogar automaticamente o período pago nem conceder outro."
      : "Contestação: bloquear novas renovações na política proposta e encaminhar para revisão, sem revogação automática."
    : scenario === "canceled"
      ? inPaidPeriod
        ? "Cancelamento voluntário: conservar o prazo já pago, sem cobranças futuras e sem tolerância após o vencimento."
        : "Cancelamento: prazo pago encerrado, sem renovação nem tolerância adicional."
      : inPaidPeriod
        ? "O prazo pago atual continua válido. A cobrança pendente ou recusada não acrescenta meses."
        : dayOffset <= 3
          ? "Tolerância proposta: manter acesso temporário até o fim do terceiro dia após o vencimento, sem estender o prazo pago."
          : "Tolerância encerrada: suspender o benefício pago na política proposta até regularização confirmada.";
  return {
    scenario,state,referenceDate,validUntilDate:due,graceThrough,
    newPeriodGranted:false,realPremiumAffected:false,
    shouldAttemptCollection:paymentFailure,
    manualReviewRequired,futureAutomaticRenewals,description,
  };
}
