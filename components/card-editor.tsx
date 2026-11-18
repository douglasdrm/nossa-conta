"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { suggestedClosingDay, type CreditCard } from "@/lib/credit-cards";
import "./credit-cards.css";
export default function CardEditor({ card, onSave, onClose }: { card?: CreditCard; onSave: (card: CreditCard) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(card?.name ?? "");
  const [due, setDue] = useState(card?.due_day ?? 12);
  const [closing, setClosing] = useState(card?.closing_day ?? 5);
  const [estimated, setEstimated] = useState(card?.closing_estimated ?? true);
  const [archived, setArchived] = useState(card?.archived ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); event.stopPropagation(); if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: card?.id, name, dueDay: due, closingDay: closing, closingEstimated: estimated, archived }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Não foi possível salvar o cartão.");
      onSave(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} className="card-editor" aria-labelledby="card-editor-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => event.stopPropagation()}>
    <form onSubmit={save}>
      <h2 id="card-editor-title">{card ? "Editar cartão" : "Cadastrar cartão"}</h2>
      <p>Só os dados para organizar suas faturas. Não informe número, senha ou código de segurança.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <label>Nome do cartão<input autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Cartão principal" /></label>
      <div className="formgrid">
        <label>Dia do vencimento<input required type="number" min={1} max={31} value={due || ""} onChange={(e) => { const value = Number(e.target.value); setDue(value); if (estimated && value >= 1 && value <= 31) setClosing(suggestedClosingDay(value)); }} /></label>
        <label>Dia do fechamento<input required type="number" min={1} max={31} value={closing || ""} onChange={(e) => { setClosing(Number(e.target.value)); setEstimated(false); }} /></label>
      </div>
      <p className="field-hint">{estimated ? "Fechamento sugerido aproximadamente sete dias antes do vencimento. Confira no app do banco e altere aqui ou depois." : "Use o fechamento informado pelo banco. Você pode corrigir depois."} Em meses curtos, usamos o último dia do mês.</p>
      {card && <><p className="field-hint">As datas valem para novas compras. Faturas existentes mantêm seus vencimentos e podem ser ajustadas separadamente quando estiverem em aberto.</p><label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Arquivar cartão para novas compras. O histórico continua disponível.</label></>}
      <div className="card-form-actions"><button className="primary" disabled={busy} type="submit">{busy ? "Salvando…" : "Salvar cartão"}</button><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancelar</button></div>
    </form>
  </dialog>, document.body);
}
