"use client";

import { useState, type FormEvent } from "react";
import { brl, plans, type BillingCycle } from "@/lib/plans";

export default function ProductionCheckout({ cycle, order }: { cycle: BillingCycle; order?: string }) {
  const plan = plans.find((option) => option.id === cycle)!;
  const [method, setMethod] = useState<"pix" | "card">("pix");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [paymentStatus, setPaymentStatus] = useState("");

  async function confirmPayment() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/production-checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível consultar o pagamento.");
      if (data.status === "confirmed" && typeof data.valid_until === "string") {
        const date = new Date(data.valid_until).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
        setPaymentStatus("Pagamento confirmado. Período Premium válido até " + date + ".");
      } else if (data.status === "manual_review") {
        setError("O pagamento precisa ser conferido. Entre em contato com o suporte antes de tentar pagar novamente.");
      } else {
        setError("O Asaas ainda não confirmou o pagamento. Consulte novamente em alguns instantes.");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/billing/production-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycle, method }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível iniciar o checkout.");
      const url = new URL(data.url);
      if (url.origin !== "https://asaas.com" || url.pathname !== "/checkoutSession/show" ||
          url.username || url.password || !url.searchParams.get("id")) {
        throw new Error("O checkout retornou um endereço inválido.");
      }
      window.location.assign(url.href);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Tente novamente.");
      setBusy(false);
    }
  }

  if (order) return (
    <div className="subscription-checkout">
      {paymentStatus ? <p role="status">{paymentStatus}</p> : (
        <button className="subscription-submit" type="button" disabled={busy} onClick={confirmPayment}>
          {busy ? "Consultando…" : "Consultar pagamento"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );

  return (
    <form className="subscription-checkout" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}>
        <legend>Como você quer pagar?</legend>
        <div className="subscription-methods">
          <label className={"subscription-method" + (method === "pix" ? " is-selected" : "")}>
            <input type="radio" name="checkout-method" value="pix" checked={method === "pix"} onChange={() => setMethod("pix")} />
            <span><strong>Pix</strong><small>Pagamento único pelo período escolhido</small></span>
          </label>
          <label className={"subscription-method" + (method === "card" ? " is-selected" : "")}>
            <input type="radio" name="checkout-method" value="card" checked={method === "card"} onChange={() => setMethod("card")} />
            <span><strong>Cartão de crédito</strong><small>Renovação automática a cada {plan.months === 1 ? "mês" : plan.months + " meses"}</small></span>
          </label>
        </div>
      </fieldset>
      <div className="subscription-total" aria-live="polite">
        <div><span>Total do plano {plan.name.toLowerCase()}</span><strong>{brl(plan.total)}</strong></div>
        <p>{method === "pix"
          ? "Pagamento único para " + plan.months + (plan.months === 1 ? " mês de acesso." : " meses de acesso.")
          : brl(plan.total) + " " + plan.period + ", com renovação automática."}</p>
        {plan.months > 1 && <p>O valor total é cobrado de uma vez. Equivalente a {brl(plan.monthly)}/mês.</p>}
      </div>
      <button className="subscription-submit" type="submit" disabled={busy}>
        {busy ? "Abrindo checkout…" : "Continuar para o pagamento"} <span aria-hidden="true">→</span>
      </button>
      <p className="subscription-payment-note">Você concluirá o pagamento no ambiente seguro do Asaas.</p>
      {error && <p className="subscription-error" role="alert">{error}</p>}
    </form>
  );
}
