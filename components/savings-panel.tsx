"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PiggyBank, Plus, Pencil, X } from "lucide-react";
import MoneyInput from "@/components/money-input";
import { moneyInputToCents } from "@/lib/finance";
import {
  savingsPlan,
  type SavingsGoal,
  type SavingsOverview,
} from "@/lib/savings";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const money = (cents: number) => currency.format(cents / 100);
const dateLabel = (date: string) => date.split("-").reverse().join("/");
const movementDate = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
});

type Editor =
  | { type: "goal"; id: string; goal?: SavingsGoal }
  | {
      type: "deposit" | "withdraw";
      id: string;
      goal: SavingsGoal;
      suggested?: number;
    }
  | { type: "buffer" };

export default function SavingsPanel({
  month,
  today,
  income,
  expenses,
  balancesLoading,
}: {
  month: string;
  today: string;
  income: number;
  expenses: number;
  balancesLoading: boolean;
}) {
  const [overview, setOverview] = useState<SavingsOverview | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadedMonth, setLoadedMonth] = useState("");
  const [loadError, setLoadError] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    setLoadError("");
    fetch("/api/savings?month=" + encodeURIComponent(month), {
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data: SavingsOverview = await response.json();
        if (!abort.signal.aborted) {
          setOverview(data);
          setLoadedMonth(month);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setLoadError("Não foi possível carregar as caixinhas.");
      });
    return () => abort.abort();
  }, [month, revision]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible")
        setRevision((value) => value + 1);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  function open(next: Editor) {
    setFormError("");
    setEditor(next);
  }

  useEffect(() => {
    if (editor && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [editor]);

  async function send(action: object, success: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setFormError("");
    setMessage("");
    const fromDialog = dialog.current?.open;
    try {
      const response = await fetch("/api/savings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Não foi possível salvar.");
      }
      setRevision((value) => value + 1);
      setMessage(success);
      if (fromDialog) dialog.current?.close();
    } catch (error) {
      const note =
        error instanceof Error ? error.message : "Não foi possível salvar.";
      if (fromDialog) setFormError(note);
      else setMessage(note);
      setRevision((value) => value + 1);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const fields = new FormData(event.currentTarget);
    const amount = moneyInputToCents(String(fields.get("amount") || ""));
    if (editor.type === "buffer") {
      void send({ action: "buffer", amount }, "Folga atualizada.");
    } else if (editor.type === "goal") {
      void send(
        {
          action: "goal",
          goalId: editor.id,
          name: fields.get("name"),
          target: amount,
          deadline: fields.get("deadline"),
          priority: Number(fields.get("priority")),
        },
        "Meta salva.",
      );
    } else {
      const status =
        editor.type === "withdraw" ? "saved" : fields.get("status");
      void send(
        {
          action: "movement",
          goalId: editor.goal.id,
          movementId: editor.id,
          kind: editor.type,
          amount,
          status,
        },
        editor.type === "withdraw"
          ? "Retirada registrada."
          : status === "planned"
            ? "Valor planejado."
            : "Valor guardado registrado.",
      );
    }
  }

  const currentMonth = month === today.slice(0, 7);
  const plan = overview && savingsPlan(overview, income, expenses, today);
  const currentBalances =
    loadedMonth === month && !balancesLoading && !loadError;
  const readyToSuggest = currentBalances && currentMonth;
  const nextPriority = Math.min(
    999,
    (overview?.goals.at(-1)?.priority || 0) + 1,
  );

  return (
    <section className="panel savings-panel" aria-labelledby="savings-heading">
      <div className="savings-heading">
        <div>
          <h2 id="savings-heading">
            <PiggyBank size={22} aria-hidden="true" /> Caixinhas
          </h2>
          <p>Planejem metas juntos e registrem quanto separaram.</p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={saving || !overview}
          onClick={() => open({ type: "goal", id: crypto.randomUUID() })}
        >
          <Plus size={16} aria-hidden="true" /> Nova caixinha
        </button>
      </div>

      {loadError && (
        <p role="alert" className="error">
          {loadError}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Tentar de novo
          </button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!overview && !loadError && <p role="status">Carregando caixinhas…</p>}
      {plan && plan.goals.length === 0 && (
        <p>Crie uma meta para uma viagem, uma compra ou sua reserva.</p>
      )}

      {plan && plan.goals.length > 0 && (
        <>
          <div className="savings-summary">
            <div>
              <span>Guardado neste mês</span>
              <strong>
                {loadedMonth === month ? money(plan.reserved) : "—"}
              </strong>
            </div>
            <div>
              <span>Saldo livre após contas e reservas</span>
              <strong>
                {currentBalances && income ? money(plan.free) : "—"}
              </strong>
            </div>
            <div>
              <span>Folga para sugerir reservas</span>
              <strong>{money(overview?.buffer || 0)}</strong>
              <button
                type="button"
                className="text-button"
                disabled={saving}
                onClick={() => open({ type: "buffer" })}
              >
                Ajustar folga
              </button>
            </div>
          </div>
          {!currentMonth && (
            <p>Volte ao mês atual para ver as sugestões de quanto guardar.</p>
          )}
          {readyToSuggest && !income && (
            <p>
              Registre receitas recebidas para calcular o saldo livre e receber
              sugestões.
            </p>
          )}
          <div className="savings-list">
            {plan.goals.map((goal) => (
              <article className="savings-goal" key={goal.id}>
                <div className="savings-goal-heading">
                  <div>
                    <h3>{goal.name}</h3>
                    <small>
                      Até {dateLabel(goal.deadline)} · prioridade{" "}
                      {goal.priority}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={saving}
                    aria-label={"Editar " + goal.name}
                    onClick={() => open({ type: "goal", id: goal.id, goal })}
                  >
                    <Pencil size={17} aria-hidden="true" /> Editar
                  </button>
                </div>
                <p>
                  <strong>{money(goal.saved)}</strong> de {money(goal.target)}{" "}
                  guardados
                </p>
                <progress
                  max={goal.target}
                  value={Math.min(goal.saved, goal.target)}
                  aria-label={"Progresso de " + goal.name}
                />
                <p>
                  {goal.missing === 0
                    ? "Meta alcançada"
                    : `Faltam ${money(goal.missing)}`}
                  {goal.expired && " · Prazo vencido"}
                </p>
                {readyToSuggest && goal.monthlyTarget > 0 && (
                  <p>
                    Meta do mês <strong>{money(goal.monthlyTarget)}</strong> ·
                    Faltam <strong>{money(goal.monthlyRemaining)}</strong>
                  </p>
                )}
                {goal.planned > 0 && (
                  <p>
                    <strong>{money(goal.planned)}</strong> planejados
                  </p>
                )}
                {readyToSuggest && goal.suggested > 0 && (
                  <button
                    type="button"
                    className="secondary savings-suggestion"
                    disabled={saving}
                    onClick={() =>
                      open({
                        type: "deposit",
                        id: crypto.randomUUID(),
                        goal,
                        suggested: goal.suggested,
                      })
                    }
                  >
                    Planejar {money(goal.suggested)} da sobra
                  </button>
                )}
                <div className="savings-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={saving}
                    onClick={() =>
                      open({ type: "deposit", id: crypto.randomUUID(), goal })
                    }
                  >
                    Registrar valor guardado
                  </button>
                  {goal.saved > 0 && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={saving}
                      onClick={() =>
                        open({
                          type: "withdraw",
                          id: crypto.randomUUID(),
                          goal,
                        })
                      }
                    >
                      Registrar retirada
                    </button>
                  )}
                </div>
                {goal.movements.length > 0 && (
                  <details className="savings-history">
                    <summary>Valores planejados e registros recentes</summary>
                    <ul>
                      {goal.movements.map((movement) => (
                        <li key={movement.id}>
                          <div>
                            <strong>{money(movement.amount)}</strong> ·{" "}
                            {movement.status === "planned"
                              ? "Planejado"
                              : movement.kind === "withdraw"
                                ? "Retirada"
                                : "Guardado"}
                            <br />
                            <small>
                              {movement.actor} ·{" "}
                              {movementDate.format(new Date(movement.date))}
                            </small>
                          </div>
                          {movement.status === "planned" && (
                            <div className="savings-actions">
                              <button
                                type="button"
                                className="text-button"
                                disabled={saving}
                                onClick={() =>
                                  void send(
                                    {
                                      action: "confirm",
                                      goalId: goal.id,
                                      movementId: movement.id,
                                    },
                                    "Valor guardado confirmado.",
                                  )
                                }
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                disabled={saving}
                                onClick={() =>
                                  void send(
                                    {
                                      action: "cancel",
                                      goalId: goal.id,
                                      movementId: movement.id,
                                    },
                                    "Planejamento cancelado.",
                                  )
                                }
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      <dialog
        ref={dialog}
        className="dialog savings-dialog"
        aria-labelledby="savings-editor-title"
        onClose={() => setEditor(null)}
        onCancel={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        {editor && (
          <form onSubmit={submit}>
            <button
              type="button"
              className="close"
              disabled={saving}
              aria-label="Fechar"
              onClick={() => dialog.current?.close()}
            >
              <X size={19} />
            </button>
            <h2 id="savings-editor-title">
              {editor.type === "goal"
                ? editor.goal
                  ? "Editar caixinha"
                  : "Nova caixinha"
                : editor.type === "buffer"
                  ? "Folga do mês"
                  : editor.type === "withdraw"
                    ? "Registrar retirada"
                    : editor.suggested
                      ? "Planejar quanto guardar"
                      : "Registrar valor guardado"}
            </h2>
            {editor.type === "goal" && (
              <>
                <label>
                  Nome da meta
                  <input
                    name="name"
                    required
                    maxLength={80}
                    defaultValue={editor.goal?.name}
                    placeholder="Ex. Viagem"
                  />
                </label>
                <div className="formgrid">
                  <label>
                    Prazo
                    <input
                      type="date"
                      name="deadline"
                      required
                      min="2000-01-01"
                      max="2099-12-31"
                      defaultValue={editor.goal?.deadline}
                    />
                  </label>
                  <label>
                    Prioridade
                    <input
                      name="priority"
                      type="number"
                      min={1}
                      max={999}
                      required
                      defaultValue={editor.goal?.priority ?? nextPriority}
                    />
                  </label>
                </div>
                <small className="field-hint">
                  A prioridade 1 recebe a sugestão primeiro.
                </small>
              </>
            )}
            {editor.type === "buffer" && (
              <p>
                Esse valor fica fora das sugestões de quanto guardar. A folga é
                compartilhada no espaço.
              </p>
            )}
            {(editor.type === "deposit" || editor.type === "withdraw") && (
              <p>{editor.goal.name}</p>
            )}
            <label>
              {editor.type === "goal"
                ? "Valor da meta"
                : editor.type === "buffer"
                  ? "Folga que querem manter"
                  : "Valor"}
              <MoneyInput
                key={editor.type}
                defaultCents={
                  editor.type === "goal"
                    ? editor.goal?.target
                    : editor.type === "buffer"
                      ? overview?.buffer
                      : editor.type === "deposit"
                        ? editor.suggested
                        : undefined
                }
              />
              <small id="money-help" className="field-hint">
                Digite só os números. Os centavos são automáticos.
              </small>
            </label>
            {editor.type === "deposit" && (
              <label>
                Situação
                <select
                  name="status"
                  defaultValue={editor.suggested ? "planned" : "saved"}
                >
                  <option value="saved">Já guardei</option>
                  <option value="planned">Planejar para depois</option>
                </select>
              </label>
            )}
            {formError && (
              <p className="error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary save" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </form>
        )}
      </dialog>
    </section>
  );
}
