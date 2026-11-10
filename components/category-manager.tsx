"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Search, Tags, X } from "lucide-react";
import { budgetKeys, budgetGroups, type BudgetGroup } from "@/lib/budget-plan";
import type { CategoryItem } from "@/lib/categories";
import { badgeStyle } from "@/lib/visual-colors";
import { useCategoryColors } from "@/components/category-colors";

export default function CategoryManager() {
  const { items, error: loadError, refresh, upsert } = useCategoryColors();
  const [kind, setKind] = useState<CategoryItem["kind"]>("expense");
  const [editing, setEditing] = useState<CategoryItem | null>(null);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<BudgetGroup | "">("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const categories = items?.filter((item) => item.kind === kind);
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  const visible = categories?.filter((item) =>
    normalize(item.name).includes(normalize(query)),
  );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    setStatus("");
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
      if (!response.ok)
        throw Error(result.error || "Não foi possível salvar a categoria.");
      upsert(result, editing.name);
      setEditing(null);
      setStatus(`Categoria ${result.name} atualizada.`);
    } catch (error) {
      setError(
        error instanceof Error
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
      aria-labelledby="category-manager-heading"
    >
      <div className="category-manager-heading">
        <span className="report-payment-heading-icon">
          <Tags size={21} aria-hidden="true" />
        </span>
        <div>
          <h2 id="category-manager-heading">Cada categoria, uma cor.</h2>
          <p>
            Reconheça suas categorias pela mesma cor nos lançamentos, gráficos e
            relatórios.
          </p>
        </div>
      </div>
      <div className="category-manager-toolbar">
        <div
          className="report-period-switch"
          role="group"
          aria-label="Tipo de categoria"
        >
          {(["expense", "income"] as const).map((type) => (
            <button
              type="button"
              key={type}
              aria-pressed={kind === type}
              disabled={busy}
              onClick={() => {
                setKind(type);
                setEditing(null);
                setQuery("");
                setError("");
                setStatus("");
              }}
            >
              {type === "expense" ? "Despesas" : "Entradas"}
            </button>
          ))}
        </div>
        <label className="category-manager-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label="Buscar categoria"
            placeholder="Buscar categoria…"
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="category-manager-caption">
        <span>
          {categories
            ? `${categories.length} ${categories.length === 1 ? "categoria" : "categorias"}`
            : "Suas categorias"}
        </span>
        <p>
          {kind === "expense"
            ? "Os grupos financeiros organizam suas despesas no Plano do mês."
            : "Organize as receitas registradas na casa."}
        </p>
      </div>
      {(error || loadError) && (
        <div role="alert" className="category-manager-error">
          <p>{error || loadError}</p>
          {loadError && (
            <button
              className="secondary"
              type="button"
              onClick={() => void refresh()}
            >
              Tentar novamente
            </button>
          )}
        </div>
      )}
      {status && (
        <p className="category-manager-success" role="status">
          {status}
        </p>
      )}
      {!items && !loadError && <p role="status">Carregando categorias…</p>}
      {visible && (
        <ul className="category-manager-grid">
          {visible.map((item) => (
            <li
              key={item.name}
              className="category-manager-card"
              style={badgeStyle(item.color)}
              data-editing={editing === item}
            >
              <div className="category-manager-card-heading">
                <span className="category-manager-icon">
                  <Tags size={21} aria-hidden="true" />
                </span>
                <div>
                  <h3>{item.name}</h3>
                  <p>
                    {item.kind === "expense"
                      ? item.group
                        ? budgetGroups[item.group]
                        : "Sem grupo financeiro"
                      : "Entrada"}
                  </p>
                </div>
                <button
                  type="button"
                  className="category-edit-button"
                  disabled={busy}
                  aria-label={`${editing === item ? "Cancelar edição de" : "Editar"} ${item.name}`}
                  aria-expanded={editing === item}
                  onClick={() => {
                    if (editing === item) {
                      setEditing(null);
                      return;
                    }
                    setName(item.name);
                    setGroup(item.group ?? "");
                    setEditing(item);
                    setStatus("");
                    setError("");
                  }}
                >
                  {editing === item ? <X size={17} /> : <Pencil size={17} />}
                </button>
              </div>
              {editing === item && (
                <form className="category-manager-form" onSubmit={save}>
                  <div className="category-manager-fields">
                    <label>
                      Nome
                      <input
                        autoFocus
                        required
                        maxLength={60}
                        value={name}
                        disabled={busy}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    {kind === "expense" && (
                      <label>
                        Grupo financeiro
                        <select
                          required
                          value={group}
                          disabled={busy}
                          onChange={(event) =>
                            setGroup(event.target.value as BudgetGroup)
                          }
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
                  </div>
                  <p className="field-hint">
                    A cor será mantida. O novo nome também aparecerá nos
                    lançamentos já registrados.
                  </p>
                  <div className="category-manager-actions">
                    <button type="submit" className="primary" disabled={busy}>
                      {busy ? "Salvando…" : "Salvar categoria"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {visible?.length === 0 && (
        <p className="report-empty">
          {query
            ? "Nenhuma categoria encontrada para essa busca."
            : "Nenhuma categoria cadastrada."}
        </p>
      )}
    </section>
  );
}
