"use client";

import { useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  House,
  Scale,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import {
  budgetAmounts,
  budgetGroup,
  budgetGroups,
  budgetKeys,
  budgetProfiles,
  budgetSpending,
  transferShare,
  suggestedBudget,
  type BudgetGroup,
  type BudgetPlan,
} from "@/lib/budget-plan";

const profileDetails = {
  house: {
    icon: House,
    description:
      "Priorize as contas essenciais e mantenha a rotina da casa organizada.",
  },
  balance: {
    icon: Scale,
    description:
      "Equilibre as despesas de hoje, os planos de amanhã e o seu bem-estar.",
  },
  goals: {
    icon: Sparkles,
    description:
      "Reserve uma parte maior para suas metas, sem deixar as contas do mês de lado.",
  },
};

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
  const [showDetails, setShowDetails] = useState(plan.enabled);
  const detailsRef = useRef<HTMLElement>(null);
  const [group, setGroup] = useState<BudgetGroup>("essentials");
  const [other, setOther] = useState<BudgetGroup>("future");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const profile = budgetProfiles.find(({ shares }) =>
    budgetKeys.every((key) => shares[key] === draft.shares[key]),
  );
  const amounts = budgetAmounts(income, draft.shares);
  const classification = { ...plan.categoryGroups, ...draft.categories };
  const spending = budgetSpending(entries, classification);
  const suggestion = balancesLoading
    ? null
    : suggestedBudget(income, entries, { ...plan, enabled: false });
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
      const saved: BudgetPlan = {
        ...(await response.json()),
        categoryGroups: plan.categoryGroups,
      };
      setDraft(saved);
      setEditing(false);
      setShowDetails(saved.enabled);
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
    <div className="budget-plan">
      <section
        className="panel budget-chooser"
        aria-labelledby="budget-choice-heading"
      >
        <div className="budget-section-heading">
          <span className="eyebrow">CADA PLANO, UM PRÓXIMO PASSO</span>
          <h2 id="budget-choice-heading">Como vocês querem dividir a renda?</h2>
          <p>
            Escolha um perfil para começar e ajuste do seu jeito. O plano é
            opcional e pode ser desativado a qualquer momento.
          </p>
        </div>
        {balancesLoading && <p role="status">Calculando a sugestão do mês…</p>}
        <div
          className="budget-profiles"
          role="group"
          aria-label="Planos disponíveis"
        >
          {budgetProfiles.map(({ id, name, shares }) => {
            const Icon = profileDetails[id].icon;
            const selected = showDetails && profile?.id === id;
            const suggested = suggestion?.profile.id === id;
            const active =
              plan.enabled &&
              budgetKeys.every((key) => plan.shares[key] === shares[key]);
            return (
              <button
                type="button"
                key={id}
                className={`budget-profile budget-profile-${id}${suggested ? " is-suggested" : ""}`}
                aria-pressed={selected}
                aria-controls="budget-plan-details"
                disabled={busy}
                onClick={() => {
                  setDraft({ ...draft, shares });
                  setEditing(true);
                  setShowDetails(true);
                  setStatus("");
                  setError("");
                  requestAnimationFrame(() => {
                    detailsRef.current?.scrollIntoView({
                      behavior: window.matchMedia(
                        "(prefers-reduced-motion: reduce)",
                      ).matches
                        ? "instant"
                        : "smooth",
                      block: "start",
                    });
                  });
                }}
              >
                <span className="budget-profile-top">
                  <span className="budget-profile-icon">
                    <Icon size={21} aria-hidden="true" />
                  </span>
                  {suggested && (
                    <span className="budget-suggestion-badge">
                      Sugestão do mês
                    </span>
                  )}
                </span>
                <strong className="budget-profile-name">{name}</strong>
                <span className="budget-profile-description">
                  {profileDetails[id].description}
                </span>
                <span className="budget-profile-shares">
                  {budgetKeys.map((key) => (
                    <span key={key}>
                      <span>{budgetGroups[key]}</span>
                      <strong>{shares[key]}%</strong>
                    </span>
                  ))}
                </span>
                <span className="budget-profile-cta">
                  {selected ? (
                    <Check size={16} aria-hidden="true" />
                  ) : (
                    <ArrowRight size={16} aria-hidden="true" />
                  )}
                  {active && !editing
                    ? "Plano ativo"
                    : selected
                      ? "Selecionado para ajustar"
                      : "Escolher este plano"}
                </span>
              </button>
            );
          })}
        </div>
        {suggestion && (
          <p className="budget-suggestion-note">
            <Sparkles size={17} aria-hidden="true" />
            <span>
              A sugestão considera as receitas e os gastos lançados: os
              essenciais representam{" "}
              <strong>{suggestion.essentialsPercent}%</strong> da renda
              prevista.
              {suggestion.essentialsOver > 0 && (
                <>
                  {" "}
                  Eles estão {money(suggestion.essentialsOver)} acima da
                  referência sugerida.
                </>
              )}{" "}
              {suggestion.available >= 0
                ? `A sobra prevista é de ${money(suggestion.available)}.`
                : `Os gastos superam as receitas em ${money(-suggestion.available)}.`}
            </span>
          </p>
        )}
      </section>

      {status && (
        <p className="budget-feedback" role="status">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {showDetails && (
        <section
          className="panel budget-details"
          ref={detailsRef}
          id="budget-plan-details"
          aria-labelledby="budget-details-heading"
        >
          <div className="budget-details-heading">
            <div className="budget-section-heading">
              <span className="eyebrow">
                {editing ? "AJUSTE DO SEU JEITO" : "PLANO DA CASA"}
              </span>
              <h2 id="budget-details-heading">
                {profile?.name ?? "Do Nosso Jeito"}
              </h2>
            </div>
            <span className="budget-detail-badge">
              {editing ? "Prévia · ainda não salvo" : "Plano ativo"}
            </span>
          </div>
          <p className="budget-income">
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

          {editing && (
            <fieldset
              disabled={busy}
              className="budget-fieldset budget-transfer"
            >
              <legend>
                <SlidersHorizontal size={18} aria-hidden="true" /> Do Nosso
                Jeito
              </legend>
              <p>
                Escolha dois grupos e mova a barra. O total continua em 100%; o
                que você acrescenta a um grupo sai do outro.
              </p>
              <div className="budget-pair">
                <label>
                  Ajustar
                  <select
                    aria-label="Ajustar"
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
                    aria-label="Redistribuir com"
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
              <label className="budget-range-label">
                <span>
                  {budgetGroups[group]} <strong>{draft.shares[group]}%</strong>{" "}
                  · {budgetGroups[other]}{" "}
                  <strong>{draft.shares[other]}%</strong>
                </span>
                <input
                  type="range"
                  aria-label={`Percentual de ${budgetGroups[group]}`}
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
            </fieldset>
          )}

          <ul
            className="budget-breakdown"
            aria-label="Divisão da renda por grupo"
          >
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
                    {money(amounts[key])} planejados
                    <br />
                    {money(spending.groups[key])} em gastos lançados
                  </small>
                )}
              </li>
            ))}
          </ul>
          {!balancesLoading && spending.unassigned > 0 && (
            <p className="budget-unassigned">
              {money(spending.unassigned)} em gastos sem grupo no plano.
            </p>
          )}
          {editing && categories.length > 0 && (
            <details className="budget-categories">
              <summary>Organizar categorias por grupo</summary>
              <div className="budget-category-fields">
                {categories.map((category) => (
                  <label key={category}>
                    {category}
                    <select
                      aria-label={`Grupo de ${category}`}
                      value={budgetGroup(category, classification) ?? ""}
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
                      {!budgetGroup(category, classification) && (
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
              </div>
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
                  {busy
                    ? "Salvando…"
                    : plan.enabled
                      ? "Salvar ajustes"
                      : "Ativar plano"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setDraft(plan);
                    setEditing(false);
                    setShowDetails(plan.enabled);
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
                  className="secondary"
                  disabled={busy}
                  onClick={() => save({ ...plan, enabled: false })}
                >
                  {busy ? "Salvando…" : "Desativar plano"}
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
