import type { BillingCycle } from "./plans";

export type RenewalScenario = "approved" | "declined" | "canceled";
export type RenewalSimulationInput = {
  cycle: BillingCycle;
  baselineValidUntil: string;
  scenario: RenewalScenario;
};
export type RenewalSimulation = {
  scenario: RenewalScenario;
  baselineValidUntil: string;
  projectedValidUntil: string;
  nextChargeExpected: boolean;
  effect: "extend" | "preserve";
  message: string;
};

const monthsByCycle: Record<BillingCycle, number> = {
  monthly: 1, quarterly: 3, yearly: 12,
};

/** Add billing months, clamping the end-of-month day in UTC. */
export function addBillingMonths(iso: string, months: number): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || !Number.isInteger(months) || months < 1) return null;
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(
    result.getUTCFullYear(), result.getUTCMonth() + 1, 0,
  )).getUTCDate();
  result.setUTCDate(Math.min(lastDay, day));
  return result.toISOString();
}

/**
 * Pure, local-only simulation. Never writes to the provider, database, or
 * permissions. It deliberately models only one hypothetical next renewal.
 * Payment reconciliation and grace periods require separate provider tests.
 */
export function simulateSandboxRenewal({
  cycle, baselineValidUntil, scenario,
}: RenewalSimulationInput): RenewalSimulation | null {
  const original = new Date(baselineValidUntil);
  if (!Number.isFinite(original.getTime()) || !(cycle in monthsByCycle)) return null;
  if (scenario !== "approved" && scenario !== "declined" && scenario !== "canceled") return null;
  const baseline = original.toISOString();
  const projected = scenario === "approved"
    ? addBillingMonths(baseline, monthsByCycle[cycle])
    : baseline;
  if (!projected) return null;

  if (scenario === "approved") {
    return {
      scenario, baselineValidUntil: baseline, projectedValidUntil: projected,
      nextChargeExpected: true, effect: "extend",
      message: "Uma renovação aprovada prorrogaria a validade por mais um período. Esta é apenas uma previsão local.",
    };
  }
  if (scenario === "declined") {
    return {
      scenario, baselineValidUntil: baseline, projectedValidUntil: projected,
      nextChargeExpected: true, effect: "preserve",
      message: "Uma cobrança recusada não prorroga a validade. O tratamento de atrasos e a tolerância ainda precisam ser definidos.",
    };
  }
  return {
    scenario, baselineValidUntil: baseline, projectedValidUntil: projected,
    nextChargeExpected: false, effect: "preserve",
    message: "Um cancelamento impediria novas renovações, preservando o prazo já pago. Estornos exigem uma regra separada.",
  };
}
