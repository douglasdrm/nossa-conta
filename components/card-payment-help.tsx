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
      <p>Uma compra vinculada à fatura mantém a forma de pagamento como cartão de crédito. Você pode escolher outro cartão ou corrigir a fatura ao editar.</p>
      <p>Compras no dia do fechamento entram na fatura que está fechando. Ajuste o mês se o banco processar de outra forma.</p>
      <button type="button" className="text-button" onClick={() => setOpen(false)}>Entendi, recolher orientação</button>
    </div>
  </details>;
}
