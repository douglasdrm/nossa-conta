"use client";

import { useState } from "react";
import type { BillingCycle } from "@/lib/plans";
import {
  simulateSandboxRenewal,
  type RenewalScenario,
} from "@/lib/sandbox-renewal-simulator";

type Props = {
  cycle: BillingCycle;
  baselineValidUntil: string;
};

const displayDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", {
  timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric",
});

const scenarioLabels: Record<RenewalScenario, string> = {
  approved: "Renovação aprovada",
  declined: "Pagamento recusado",
  canceled: "Cancelamento",
};

export default function SandboxRenewalSimulator({cycle,baselineValidUntil}: Props) {
  const [scenario,setScenario] = useState<RenewalScenario | null>(null);
  const simulation = scenario ? simulateSandboxRenewal({
    cycle, baselineValidUntil, scenario,
  }) : null;

  return (
    <section aria-label="Simulador local de renovação" className="sandbox-simulator">
      <h4>Simular próximo ciclo</h4>
      <p>Teste visual sem cobrança, sem comunicação com o Asaas e sem alterar a validade ou o Premium de ninguém.</p>
      <p><strong>Validade atual registrada:</strong> {displayDate(baselineValidUntil)}</p>
      <div className="sandbox-simulator-actions" role="group" aria-label="Cenários de renovação">
        {(["approved","declined","canceled"] as const).map(option => (
          <button type="button" key={option}
            aria-pressed={scenario === option}
            onClick={() => setScenario(option)}>
            {scenarioLabels[option]}
          </button>
        ))}
      </div>
      {simulation && (
        <div aria-live="polite" className="sandbox-simulator-result">
          <p><strong>Cenário:</strong> {scenarioLabels[simulation.scenario]}</p>
          <p><strong>Validade projetada:</strong> {displayDate(simulation.projectedValidUntil)}</p>
          <p><strong>Novas cobranças previstas:</strong> {simulation.nextChargeExpected ? "Sim" : "Não"}</p>
          <p>{simulation.message}</p>
          <button type="button" onClick={() => setScenario(null)}>Limpar simulação</button>
        </div>
      )}
      <small>O resultado não é salvo. Recarregar a página restaura o cenário inicial.</small>
    </section>
  );
}
