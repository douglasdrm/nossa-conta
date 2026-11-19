"use client";
import { useEffect, useState } from "react";

const preferenceKey = "nc-card-payment-help-seen-v1";
export default function CardPaymentHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(preferenceKey) !== "true") {
        setOpen(true);
        localStorage.setItem(preferenceKey, "true");
      }
    } catch {
      // The help remains available without requiring browser storage.
    }
  }, []);
  return <details className="card-payment-help" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Como funciona o pagamento no cartão?</summary>
    <div>
      <p>A compra ou cobrança fica a pagar na fatura. Confirme o pagamento em Cartões quando ele acontecer.</p>
      <p>Ao editar uma compra em aberto, você pode escolher outro cartão ou outra forma de pagamento. Ao deixar de ser crédito, ela sai da fatura.</p>
      <p>Compras no dia do fechamento entram na fatura que está fechando. Ajuste o mês se o banco processar de outra forma.</p>
      <button type="button" className="text-button" onClick={() => setOpen(false)}>Entendi, recolher orientação</button>
    </div>
  </details>;
}
