"use client";
import { useEffect, useState } from "react";
import CardEditor from "./card-editor";
import { cardDay, firstInvoiceMonth, type CreditCard } from "@/lib/credit-cards";
import { dateInSaoPaulo, installmentDate } from "@/lib/finance";
export default function CardPurchaseFields({ initial, recurring = false, onReadyChange }: { recurring?: boolean; initial?: { credit_card_id?: string | null; purchase_date?: string | null; date: string; installment_number?: number | null }; onReadyChange: (ready: boolean) => void }) {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [selected, setSelected] = useState(initial?.credit_card_id ?? "");
  const [purchase, setPurchase] = useState(initial?.purchase_date ?? dateInSaoPaulo());
  const [invoice, setInvoice] = useState(initial?.credit_card_id ? initial.date.slice(0, 7) : "");
  const [manual, setManual] = useState(Boolean(initial?.credit_card_id));
  const [editor, setEditor] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError("");
    try { const r = await fetch("/api/cards?catalog=true"); const b = await r.json(); if (!r.ok) throw Error(b.error); setCards(b.cards); }
    catch { setError("Não foi possível carregar os cartões. Tente novamente."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { onReadyChange(Boolean(selected) && !loading && !error && !editor); return () => onReadyChange(true); }, [selected, loading, error, editor, onReadyChange]);
  const card = cards.find((c) => c.id === selected);
  const suggested = card && /^20\d{2}-\d{2}-\d{2}$/.test(purchase) ? installmentDate(firstInvoiceMonth(purchase, card.closing_day, card.due_day) + "-01", (initial?.installment_number ?? 1) - 1).slice(0, 7) : "";
  const chosen = manual ? invoice : suggested;
  const due = card && chosen ? cardDay(chosen, card.due_day) : "";
  return <div className="card-purchase-fields">
    {error && <p role="alert">{error} <button type="button" className="text-button" onClick={() => void load()}>Tentar novamente</button></p>}
    <label>Em qual cartão?<select name="cardId" required value={selected} disabled={loading} onChange={(e) => { if (e.target.value === "new") { setEditor(true); return; } setSelected(e.target.value); setManual(false); }}>
      <option value="">{loading ? "Carregando cartões…" : "Selecione um cartão"}</option>
      {cards.filter((c) => !c.archived || c.id === selected).map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived ? " (arquivado)" : ""}</option>)}
      <option value="new">+ Cadastrar cartão</option>
    </select></label>
    <button className="text-button" type="button" onClick={() => setEditor(true)}>+ Cadastrar cartão rapidamente</button>
    <div className="formgrid"><label>{recurring ? initial?.credit_card_id ? "Data desta cobrança" : "Data da próxima cobrança" : "Data da compra"}<input required name="purchaseDate" type="date" min="2000-01-01" max="2099-12-31" value={purchase} onChange={(e) => setPurchase(e.target.value)} /></label>
    <label>{initial?.installment_number ? "Fatura desta parcela" : recurring ? "Fatura da cobrança" : "Primeira fatura"}<input required name="invoiceMonth" type="month" min="2000-01" max="2099-12" value={chosen} onChange={(e) => { setInvoice(e.target.value); setManual(true); }} /></label></div>
    {due && <p className="card-purchase-notice">{initial?.installment_number ? "Esta parcela vai para" : "A compra começa na"} fatura de <strong>{chosen.split("-").reverse().join("/")}</strong>, com vencimento padrão em <strong>{due.split("-").reverse().join("/")}</strong>. O mês pode ser ajustado acima; faturas existentes mantêm seu vencimento.</p>}
    {editor && <CardEditor onClose={() => setEditor(false)} onSave={(saved) => { setCards((current) => [...current, saved]); setSelected(saved.id); setManual(false); setError(""); setEditor(false); }} />}
  </div>;
}
