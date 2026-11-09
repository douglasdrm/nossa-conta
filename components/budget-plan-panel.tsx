"use client";

import { useState } from "react";
import {
  budgetAmounts,
  budgetGroup,
  budgetGroups,
  budgetKeys,
  budgetProfiles,
  budgetSpending,
  transferShare,
  type BudgetGroup,
  type BudgetPlan,
} from "@/lib/budget-plan";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const money = (amount: number) => brl.format(amount / 100);

export default function BudgetPlanPanel({
  plan,
  income,
  entries,
  balancesLoading,
  onSave,
}: {
  plan: BudgetPlan;
  income: number;
  entries: { kind: string; category: string; amount: number }[];
  balancesLoading: boolean;
  onSave: (plan: BudgetPlan) => void;
}) {
  const [draft, setDraft] = useState(plan);
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState("");
  const [group, setGroup] = useState<BudgetGroup>("essentials");
  const [other, setOther] = useState<BudgetGroup>("future");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const profile = budgetProfiles.find(({ shares }) =>
    budgetKeys.every((key) => shares[key] === draft.shares[key]),
  );
  const amounts = budgetAmounts(income, draft.shares);
  const spending = budgetSpending(entries, draft.categories);
  const categories = [
    ...new Set(
      entries
        .filter(({ kind }) => kind === "expense")
        .map(({ category }) => category),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  async function save(next: BudgetPlan) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/budget-plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw Error();
      const saved: BudgetPlan = await response.json();
      setDraft(saved);
      setEditing(false);
      onSave(saved);
      setStatus(
        saved.enabled ? "Plano salvo para a casa." : "Plano desativado.",
      );
    } catch {
      setError("Não foi possível salvar o plano. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="budget-plan panel" aria-label="Configuração do plano">
      <p>
        Escolha como dividir a renda registrada da casa. O plano é opcional e
        pode ser desativado a qualquer momento.
      </p>
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!plan.enabled && !editing ? (
        <button
          type="button"
          className="primary"
          onClick={() => {
            setEditing(true);
            setStatus("");
          }}
        >
          Configurar plano
        </button>
      ) : (
        <>
          {editing && (
            <fieldset disabled={busy} className="budget-fieldset">
              <legend>O que você quer priorizar?</legend>
              <select
                aria-label="Objetivo do plano"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
              >
                <option value="">Ver todos os perfis</option>
                {budgetProfiles.map(({ id, goal }) => (
                  <option key={id} value={id}>
                    {goal}
                  </option>
                ))}
              </select>
              <div className="budget-profiles">
                {budgetProfiles
                  .filter(({ id }) => !goal || id === goal)
                  .map(({ id, name, shares, goal }) => (
                    <button
                      type="button"
                      key={id}
                      aria-pressed={profile?.id === id}
                      onClick={() => setDraft({ ...draft, shares })}
                    >
                      <strong>{name}</strong>
                      <span>{goal}</span>
                      <span>
                        {budgetKeys.map((key) => shares[key] + "%").join(" · ")}
                      </span>
                    </button>
                  ))}
              </div>
              <div className="budget-transfer">
                <h3>Do Nosso Jeito</h3>
                <p>
                  Escolha dois grupos e mova a barra. A diferença vai para o
                  outro grupo ou sai dele.
                </p>
                <div className="budget-pair">
                  <label>
                    Ajustar
                    <select
                      value={group}
                      onChange={(event) => {
                        const next = event.target.value as BudgetGroup;
                        if (next === other) setOther(group);
                        setGroup(next);
                      }}
                    >
                      {budgetKeys.map((key) => (
                        <option key={key} value={key}>
                          {budgetGroups[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Redistribuir com
                    <select
                      value={other}
                      onChange={(event) =>
                        setOther(event.target.value as BudgetGroup)
                      }
                    >
                      {budgetKeys
                        .filter((key) => key !== group)
                        .map((key) => (
                          <option key={key} value={key}>
                            {budgetGroups[key]}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <label>
                  {budgetGroups[group]} {draft.shares[group]}% ·{" "}
                  {budgetGroups[other]} {draft.shares[other]}%
                  <input
                    type="range"
                    min={0}
                    max={draft.shares[group] + draft.shares[other]}
                    value={draft.shares[group]}
                    disabled={draft.shares[group] + draft.shares[other] === 0}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        shares: transferShare(
                          draft.shares,
                          group,
                          other,
                          event.target.valueAsNumber,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            </fieldset>
          )}
          <h2>{profile?.name ?? "Do Nosso Jeito"}</h2>
          <p>
            {balancesLoading ? (
              "Carregando lançamentos do mês…"
            ) : income > 0 ? (
              <>
                Com base em <strong>{money(income)}</strong> de receitas
                lançadas, incluindo as previstas.
              </>
            ) : (
              "Informe uma receita quando quiser visualizar o plano em reais."
            )}
          </p>
          <ul className="budget-breakdown">
            {budgetKeys.map((key) => (
              <li key={key} data-group={key}>
                <div>
                  <strong>{budgetGroups[key]}</strong>
                  <span>{draft.shares[key]}%</span>
                </div>
                <progress
                  max={100}
                  value={draft.shares[key]}
                  aria-label={budgetGroups[key]}
                />
                {!balancesLoading && income > 0 && (
                  <small>
                    {money(amounts[key])} planejados ·{" "}
                    {money(spending.groups[key])} em gastos lançados
                  </small>
                )}
              </li>
            ))}
          </ul>
          {!balancesLoading && spending.unassigned > 0 && (
            <p>{money(spending.unassigned)} em gastos sem grupo no plano.</p>
          )}
          {editing && categories.length > 0 && (
            <details className="budget-categories">
              <summary>Organizar categorias por grupo</summary>
              {categories.map((category) => (
                <label key={category}>
                  {category}
                  <select
                    value={budgetGroup(category, draft.categories) ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        categories: {
                          ...draft.categories,
                          [category]: event.target.value as BudgetGroup,
                        },
                      })
                    }
                  >
                    {!budgetGroup(category, draft.categories) && (
                      <option value="" disabled>
                        Sem grupo
                      </option>
                    )}
                    {budgetKeys.map((key) => (
                      <option key={key} value={key}>
                        {budgetGroups[key]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </details>
          )}
          <div className="budget-actions">
            {editing ? (
              <>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => save({ ...draft, enabled: true })}
                >
                  {plan.enabled ? "Salvar ajustes" : "Ativar plano"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(plan);
                    setEditing(false);
                    setError("");
                  }}
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setEditing(true);
                    setStatus("");
                  }}
                >
                  Editar plano
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => save({ ...plan, enabled: false })}
                >
                  Desativar plano
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
