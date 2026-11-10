"use client";

import { useEffect, useState, type FormEvent } from "react";
import { budgetKeys, budgetGroups, type BudgetGroup } from "@/lib/budget-plan";
import type { CategoryItem } from "@/lib/categories";

export default function CategoryManager() {
  const [items, setItems] = useState<CategoryItem[] | null>(null);
  const [kind, setKind] = useState<CategoryItem["kind"]>("expense");
  const [editing, setEditing] = useState<CategoryItem | null>(null);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<BudgetGroup | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/categories", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        setItems(await response.json());
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Não foi possível carregar as categorias. Atualize a página para tentar novamente.",
          );
      });
    return () => controller.abort();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          oldName: editing.name,
          name,
          group: group || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setItems(
        (rows) =>
          rows?.map((item) =>
            item === editing
              ? { kind, name: result.name, group: group || null }
              : item,
          ) ?? null,
      );
      setEditing(null);
      setStatus(`Categoria ${result.name} atualizada.`);
    } catch (error) {
      setError(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível salvar a categoria.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel category-manager"
      aria-label="Gerenciar categorias"
    >
      <p>
        Os grupos financeiros organizam as despesas no Plano do mês. Ao criar
        uma categoria de despesa, escolha em qual grupo ela entra.
      </p>
      <div className="report-modes" aria-label="Tipo de categoria" role="group">
        {(["expense", "income"] as const).map((type) => (
          <button
            key={type}
            type="button"
            disabled={busy}
            aria-pressed={kind === type}
            onClick={() => {
              setKind(type);
              setEditing(null);
              setError("");
              setStatus("");
            }}
          >
            {type === "expense" ? "Despesas" : "Entradas"}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {!items && !error && <p role="status">Carregando categorias…</p>}
      {items
        ?.filter((item) => item.kind === kind)
        .map((item) => (
          <div key={item.name} className="category-manager-row">
            <div>
              <strong>{item.name}</strong>
              {kind === "expense" && (
                <small>
                  {item.group
                    ? budgetGroups[item.group]
                    : "Sem grupo financeiro"}
                </small>
              )}
            </div>
            {editing === item ? (
              <form onSubmit={save}>
                <label>
                  Nome
                  <input
                    required
                    maxLength={60}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </label>
                {kind === "expense" && (
                  <label>
                    Grupo financeiro
                    <select
                      required
                      value={group}
                      onChange={(e) => setGroup(e.target.value as BudgetGroup)}
                      disabled={busy}
                    >
                      <option value="" disabled>
                        Escolha um grupo
                      </option>
                      {budgetKeys.map((key) => (
                        <option key={key} value={key}>
                          {budgetGroups[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? "Salvando…" : "Salvar categoria"}
                </button>{" "}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  Cancelar
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                aria-label={`Editar ${item.name}`}
                onClick={() => {
                  setName(item.name);
                  setGroup(item.group ?? "");
                  setEditing(item);
                  setStatus("");
                  setError("");
                }}
              >
                Editar
              </button>
            )}
          </div>
        ))}
    </section>
  );
}
