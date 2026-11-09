"use client";
import { useEffect, useState } from "react";
import { budgetGroups, budgetKeys, type BudgetGroup } from "@/lib/budget-plan";
import { Plus } from "lucide-react";
export default function CategoryPicker({
  kind,
  defaults,
  initial,
  onPendingChange,
}: {
  kind: string;
  defaults: string[];
  initial?: string;
  onPendingChange: (pending: boolean) => void;
}) {
  const [group, setGroup] = useState<BudgetGroup | "">("");
  const [custom, setCustom] = useState<string[]>([]);
  const [selected, setSelected] = useState(initial || defaults[0]);
  const [adding, setAdding] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    onPendingChange(adding || busy);
    return () => onPendingChange(false);
  }, [adding, busy, onPendingChange]);
  useEffect(() => {
    let active = true;
    fetch("/api/categories")
      .then(async (r) => {
        if (!r.ok) throw Error();
        const items: { kind: string; name: string }[] = await r.json();
        if (active)
          setCustom(items.filter((c) => c.kind === kind).map((c) => c.name));
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
  }, [kind]);
  const options = [
    ...new Set([...defaults, ...custom, selected].filter(Boolean)),
  ];
  async function add() {
    if (busy) return;
    const clean = name.trim();
    if (!clean || clean.length > 60) {
      setError("Informe um nome de até 60 caracteres.");
      return;
    }
    const existing = options.find(
      (c) => c.toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR"),
    );
    if (existing) {
      setSelected(existing);
      setAdding(false);
      setName("");
      setError("");
      return;
    }
    if (kind === "expense" && !group) {
      setError("Escolha o grupo financeiro da despesa.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name: clean,
          group: kind === "expense" ? group : null,
        }),
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(data.error || "Não foi possível criar a categoria.");
      setCustom((current) => [...current, data.name]);
      setSelected(data.name);
      setAdding(false);
      setName("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível criar a categoria.",
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
          onChange={(e) => setSelected(e.target.value)}
        >
          {options.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {!adding ? (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setGroup("");
            setAdding(true);
            setError("");
          }}
        >
          <Plus size={14} aria-hidden="true" /> Adicionar categoria
        </button>
      ) : (
        <div className="new-category">
          <label>
            Nome da nova categoria
            <input
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Pets, Academia, Presentes"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
              disabled={busy}
            />
          </label>
          {kind === "expense" && (
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
              onClick={() => void add()}
              disabled={busy}
            >
              {busy ? "Criando…" : "Criar categoria"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setName("");
                setError("");
              }}
            >
              Cancelar
            </button>
          </div>
          <small className="field-hint">
            Disponível para todos no espaço compartilhado.
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
