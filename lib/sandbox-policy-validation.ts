import { simulateSandboxBillingPolicy, type BillingPolicyScenario, type BillingPolicyState } from "./sandbox-billing-policy";

export type PolicyCheck = {
  name: string;
  scenario: BillingPolicyScenario;
  offset: number;
  expectedState: BillingPolicyState;
  observedState: BillingPolicyState | null;
  passed: boolean;
};
export type PolicyValidation = {
  checks: PolicyCheck[];
  passed: number;
  total: number;
  allPassed: boolean;
};

// The expected states are deliberately specified separately from the policy function.
// This validates the proposal's boundary behavior, without any external API or writes.
const states: Record<BillingPolicyScenario, readonly BillingPolicyState[]> = {
  pending: ["paid_period", "paid_period", "grace", "grace", "unpaid"],
  declined: ["paid_period", "paid_period", "grace", "grace", "unpaid"],
  canceled: ["paid_period", "paid_period", "unpaid", "unpaid", "unpaid"],
  refunded: ["manual_review", "manual_review", "manual_review", "manual_review", "manual_review"],
  disputed: ["manual_review", "manual_review", "manual_review", "manual_review", "manual_review"],
};
const offsets = [-1, 0, 1, 3, 4] as const;
const names: Record<BillingPolicyScenario,string> = {
  pending:"Pagamento pendente",
  declined:"Pagamento recusado",
  canceled:"Cancelamento voluntário",
  refunded:"Estorno total",
  disputed:"Contestação",
};
export function validateSandboxBillingPolicy(validUntil: string): PolicyValidation {
  const checks: PolicyCheck[]=[];
  for (const scenario of Object.keys(states) as BillingPolicyScenario[]) {
    offsets.forEach((offset,index)=>{
      const result = simulateSandboxBillingPolicy({validUntil,scenario,dayOffset:offset});
      const expectedState = states[scenario][index];
      const passed = !!result && result.state===expectedState &&
        result.newPeriodGranted===false && result.realPremiumAffected===false &&
        result.manualReviewRequired===(scenario==="refunded"||scenario==="disputed") &&
        result.futureAutomaticRenewals===(scenario==="pending"||scenario==="declined");
      checks.push({
        name:names[scenario],scenario,offset,expectedState,
        observedState:result?.state??null,passed,
      });
    });
  }
  const passed=checks.filter(c=>c.passed).length;
  return {checks,passed,total:checks.length,allPassed:passed===checks.length};
}
