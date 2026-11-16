"use client";

import { useState, type FormEvent } from "react";
import type { BillingCycle } from "@/lib/plans";

export default function ProductionCheckout({ cycle, order }: { cycle: BillingCycle; order?: string }) {
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
    <div>
      {paymentStatus ? <p role="status">{paymentStatus}</p> : (
        <button className="marketing-cta" type="button" disabled={busy} onClick={confirmPayment}>
          {busy ? "Consultando…" : "Consultar pagamento"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );

  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Forma de pagamento</legend>
        <label>
          <input type="radio" name="checkout-method" checked={method === "pix"} onChange={() => setMethod("pix")} />
          Pix, pagamento por período
        </label>
        <label>
          <input type="radio" name="checkout-method" checked={method === "card"} onChange={() => setMethod("card")} />
          Cartão, renovação automática
        </label>
      </fieldset>
      <button className="marketing-cta" type="submit" disabled={busy}>
        {busy ? "Abrindo checkout…" : "Continuar para o Asaas"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
