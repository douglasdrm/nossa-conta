"use client";
import { useEffect, useState } from "react";
import CardEditor from "./card-editor";
import type { CreditCard } from "@/lib/credit-cards";
import { dateInSaoPaulo } from "@/lib/finance";
import "./credit-cards.css";
type Invoice = { id: string; card_id: string; invoice_month: string; due_date: string; paid_at: string | null; payer: string | null };
type Purchase = { rule_id?: string | null; expense_type?: string | null; recurrence_interval?: number | null; id: string; description: string; amount: number; category: string; person: string; credit_card_id: string; card_invoice_id: string; purchase_date: string; date: string; confirmed: boolean; installment_number: number | null; installment_count: number | null };
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
const date = (value: string) => value.slice(0, 10).split("-").reverse().join("/");
export default function CreditCardsPanel({ name, onEdit }: { name: string; onEdit: (id: string, month: string) => void }) {
  const [data, setData] = useState<{ cards: CreditCard[]; invoices: Invoice[]; entries: Purchase[]; blockedCharges?: number } | null>(null);
  const [editor, setEditor] = useState<CreditCard | "new" | null>(null);
  const [cardFilter, setCardFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try { const response = await fetch("/api/cards"); const result = await response.json(); if (!response.ok) throw Error(result.error); setData(result); }
    catch (error) { setError(error instanceof Error ? error.message : "Não foi possível carregar."); }
  }
  useEffect(() => { void load(); }, []);
  async function action(body: object, message: string, endpoint = "/api/cards") {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try { const r = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await r.json(); if (!r.ok) throw Error(result.error); await load(); setNotice(message); }
    catch (error) { setError(error instanceof Error ? error.message : "Não foi possível atualizar."); }
    finally { setBusy(false); }
  }
  const invoices = data?.invoices.filter((i) => (i.paid_at || data.entries.some((e) => e.card_invoice_id === i.id)) && (!cardFilter || i.card_id === cardFilter) && (!monthFilter || i.invoice_month.slice(0, 7) === monthFilter));
  return <section className="cards-panel" aria-label="Seus cartões e faturas">
    <p className="cards-intro">Registre a compra no cartão e acompanhe o total da fatura. O pagamento é confirmado por você, quando acontecer, sem duplicar suas despesas. Todos os participantes com acesso ao espaço veem os cartões e as compras.</p>
    {error && <p role="alert" className="error">{error} <button type="button" className="text-button" onClick={() => void load()}>Tentar novamente</button></p>}
    {Boolean(data?.blockedCharges) && <p role="alert" className="notice">Há {data?.blockedCharges} cobrança(s) recorrente(s) que não puderam entrar na previsão porque a fatura correspondente já está paga. Confira as faturas e reabra a que precisar receber essas cobranças.</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <button className="primary" type="button" onClick={() => setEditor("new")}>+ Cadastrar cartão</button>
    {!data && !error && <p role="status">Carregando cartões…</p>}
    {data && !data.cards.length && <div className="empty"><h2>Seu primeiro cartão começa aqui.</h2><p>Cadastre o nome, fechamento e vencimento. Depois, selecione o cartão ao lançar uma compra.</p></div>}
    <div className="cards-grid">{data?.cards.map((card) => <article className="card-summary" key={card.id}><h2>{card.name}{card.archived ? " · Arquivado" : ""}</h2><p>Fecha dia <strong>{card.closing_day}</strong> · vence dia <strong>{card.due_day}</strong></p>{card.closing_estimated && <small>Fechamento aproximado. Confira no app do banco.</small>}<p>Em aberto <strong>{money(data.entries.filter((e) => e.credit_card_id === card.id && !e.confirmed).reduce((sum, e) => sum + Number(e.amount), 0))}</strong></p><button className="text-button" type="button" onClick={() => setEditor(card)}>Editar cartão e datas</button></article>)}</div>
    {Boolean(data?.cards.length) && <><h2>Faturas</h2><p className="field-hint">Os totais incluem apenas as compras cadastradas aqui. Compras antigas sem cartão vinculado continuam em Lançamentos. Não lance o total da fatura como uma nova despesa. As recorrências mostram até 12 meses de cobranças previstas. Encerrar a recorrência aqui não cancela o serviço no fornecedor.</p>
    <div className="cards-filter"><label>Cartão<select value={cardFilter} onChange={(e) => setCardFilter(e.target.value)}><option value="">Todos os cartões</option>{data?.cards.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>Mês da fatura<select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}><option value="">Todos os meses</option>{[...new Set(data?.invoices.map((i) => i.invoice_month.slice(0, 7)))].map((m) => <option value={m} key={m}>{m.split("-").reverse().join("/")}</option>)}</select></label></div>
    {!invoices?.length && <p>Nenhuma fatura neste filtro. Cadastre uma compra escolhendo seu cartão.</p>}
    {invoices?.map((invoice) => {
      const entries = data!.entries.filter((e) => e.card_invoice_id === invoice.id);
      if (!entries.length && !invoice.paid_at) return null;
      const card = data!.cards.find((c) => c.id === invoice.card_id);
      return <article className="card-invoice" key={invoice.id}>
        <div className="card-invoice-title"><div><h3>{card?.name} · {invoice.invoice_month.slice(0, 7).split("-").reverse().join("/")}</h3><p>Vencimento em {date(invoice.due_date)}<br />{invoice.paid_at ? `Paga por ${invoice.payer} · confirmação em ${new Date(invoice.paid_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : invoice.due_date < dateInSaoPaulo() ? "Em aberto · vencida" : "Em aberto"}</p></div><strong>{money(entries.reduce((sum, e) => sum + Number(e.amount), 0))}</strong></div>
        {!invoice.paid_at ? <>
          <form className="card-invoice-controls" onSubmit={(e) => { e.preventDefault(); const payer = String(new FormData(e.currentTarget).get("payer")); if (confirm("Confirmar o pagamento integral das compras desta fatura? Não será criada outra despesa.")) void action({ id: invoice.id, action: "pay", payer }, "Pagamento da fatura confirmado. As compras foram marcadas como pagas."); }}><label>Quem pagou a fatura?<input name="payer" defaultValue={name} required maxLength={60} /></label><button className="primary" disabled={busy} type="submit">Confirmar pagamento integral</button></form>
          <details><summary>Corrigir vencimento desta fatura</summary><form className="card-invoice-controls" onSubmit={(e) => { e.preventDefault(); void action({ id: invoice.id, action: "due", dueDate: new FormData(e.currentTarget).get("due") }, "Vencimento da fatura atualizado."); }}><label>Vencimento no mesmo mês<input key={invoice.due_date} type="date" name="due" defaultValue={invoice.due_date} required /></label><button type="submit" disabled={busy}>Salvar vencimento</button></form></details>
        </> : <button type="button" className="text-button" disabled={busy} onClick={() => { if (confirm("Reabrir esta fatura e deixar todas as suas compras a pagar?")) void action({ id: invoice.id, action: "reopen" }, "Fatura reaberta. As compras voltaram a pagar."); }}>Corrigir confirmação e reabrir fatura</button>}
        <details><summary>{entries.length} compra(s) nesta fatura</summary>{entries.map((entry) => <div className="card-purchase-row" key={entry.id}><span><b>{entry.description}</b>{entry.installment_count && ` · ${entry.installment_number}/${entry.installment_count}`}{entry.expense_type && ` · ${entry.expense_type === "subscription" ? "Assinatura" : "Conta recorrente"} ${entry.recurrence_interval === 12 ? "anual" : "mensal"}`}<small>Compra em {date(entry.purchase_date)} · {entry.category} · {entry.person}</small>{!invoice.paid_at && <button type="button" className="text-button" onClick={() => onEdit(entry.id, entry.date.slice(0, 7))}>Editar compra ou fatura</button>}{entry.rule_id && <button type="button" className="text-button" disabled={busy} onClick={() => { if (confirm("Encerrar após esta cobrança? Próximas cobranças em aberto sairão da previsão. As já pagas serão preservadas.")) void action({ id: entry.id, action: "stop" }, "Recorrência encerrada após esta cobrança. Cobranças futuras em aberto foram retiradas da previsão.", "/api/entries"); }}>Encerrar recorrência após esta cobrança</button>}</span><strong>{money(Number(entry.amount))}</strong></div>)}</details>
      </article>;
    })}</>}
    {editor && <CardEditor card={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} onSave={() => { setEditor(null); void load(); setNotice("Cartão salvo. O histórico das faturas foi preservado."); }} />}
  </section>;
}
