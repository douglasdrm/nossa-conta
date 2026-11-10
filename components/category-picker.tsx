"use client";
import { useEffect, useState } from "react";
import { budgetGroups, budgetKeys, type BudgetGroup } from "@/lib/budget-plan";
import { Pencil, Plus } from "lucide-react";
export default function CategoryPicker({
  kind,
  defaults,
  initial,
  onPendingChange,
  onRename,
}: {
  kind: string;
  defaults: string[];
  initial?: string;
  onPendingChange: (pending: boolean) => void;
  onRename: () => void;
}) {
  const [group, setGroup] = useState<BudgetGroup | "">("");
  const [custom, setCustom] = useState<string[] | null>(null);
  const [selected, setSelected] = useState(initial || defaults[0]);
  const [mode, setMode] = useState<"add" | "rename" | null>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    onPendingChange(mode !== null || busy);
    return () => onPendingChange(false);
  }, [mode, busy, onPendingChange]);
  useEffect(() => {
    let active = true;
    fetch("/api/categories")
      .then(async (r) => {
        if (!r.ok) throw Error();
        const items: { kind: string; name: string }[] = await r.json();
        if (active) {
          const names = items.filter((c) => c.kind === kind).map((c) => c.name);
          setCustom(names);
          setSelected((current) =>
            initial || names.includes(current)
              ? current
              : (names[0] ?? current),
          );
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Não foi possível carregar as categorias salvas. Reabra o lançamento para tentar novamente.",
          );
      });
    return () => {
      active = false;
    };
  }, [kind, initial]);
  const options = [
    ...new Set([...(custom ?? defaults), selected].filter(Boolean)),
  ];
  async function saveCategory() {
    if (busy) return;
    const clean = name.trim();
    if (!clean || clean.length > 60) {
      setError("Informe um nome de até 60 caracteres.");
      return;
    }
    const existing = options.find(
      (c) => c.toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR"),
    );
    if (mode === "add" && existing) {
      setSelected(existing);
      setMode(null);
      setName("");
      setError("");
      return;
    }
    if (mode === "add" && kind === "expense" && !group) {
      setError("Escolha o grupo financeiro da despesa.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/categories", {
        method: mode === "rename" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name: clean,
          ...(mode === "rename"
            ? { oldName: selected }
            : { group: kind === "expense" ? group : null }),
        }),
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(data.error || "Não foi possível salvar a categoria.");
      setCustom((current) =>
        mode === "rename"
          ? (current ?? defaults).map((category) =>
              category === selected ? data.name : category,
            )
          : [...(current ?? defaults), data.name],
      );
      if (mode === "rename") onRename();
      setSelected(data.name);
      setMode(null);
      setName("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível salvar a categoria.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="category-picker">
      <label>
        Categoria
        <select
          name="category"
          value={selected}
          disabled={mode !== null}
          onChange={(e) => setSelected(e.target.value)}
        >
          {options.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {!mode ? (
        <div className="entry-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setGroup("");
              setMode("add");
              setError("");
            }}
          >
            <Plus size={14} aria-hidden="true" /> Adicionar categoria
          </button>
          {custom?.includes(selected) && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setName(selected);
                setMode("rename");
                setError("");
              }}
            >
              <Pencil size={14} aria-hidden="true" /> Editar categoria
            </button>
          )}
        </div>
      ) : (
        <div className="new-category">
          <label>
            {mode === "rename"
              ? "Novo nome da categoria"
              : "Nome da nova categoria"}
            <input
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Pets, Academia, Presentes"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveCategory();
                }
              }}
              disabled={busy}
            />
          </label>
          {mode === "add" && kind === "expense" && (
            <label>
              Grupo financeiro
              <select
                value={group}
                disabled={busy}
                onChange={(event) =>
                  setGroup(event.target.value as BudgetGroup | "")
                }
              >
                <option value="">Escolha um grupo</option>
                {budgetKeys.map((key) => (
                  <option key={key} value={key}>
                    {budgetGroups[key]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div>
            <button
              type="button"
              className="secondary"
              onClick={() => void saveCategory()}
              disabled={busy}
            >
              {busy
                ? "Salvando…"
                : mode === "rename"
                  ? "Salvar nome"
                  : "Criar categoria"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setMode(null);
                setName("");
                setError("");
              }}
            >
              Cancelar
            </button>
          </div>
          <small className="field-hint">
            {mode === "rename"
              ? "O novo nome também aparece nos lançamentos já registrados."
              : "Disponível para todos no espaço compartilhado."}
          </small>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
