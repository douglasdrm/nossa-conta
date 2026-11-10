"use client";

import { useState } from "react";
import {
  ArrowRightLeft,
  Banknote,
  Barcode,
  ChevronDown,
  CircleHelp,
  CreditCard,
  QrCode,
} from "lucide-react";
import { paymentMethodLabels, type PaymentMethod } from "@/lib/payment-methods";

import { badgeStyle, paymentColors } from "@/lib/visual-colors";
import ReportPurchases from "@/components/report-purchases";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const money = (amount: number) => currency.format(amount / 100);
const methodIcons = {
  pix: QrCode,
  cash: Banknote,
  credit_card: CreditCard,
  debit_card: CreditCard,
  bank_slip: Barcode,
  transfer: ArrowRightLeft,
  other: Banknote,
};

export default function PaymentMethodReport({
  methods,
  query,
}: {
  methods: { method: PaymentMethod | null; total: number }[];
  query: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <section
      className="report-payment-card"
      aria-labelledby="report-payment-heading"
    >
      <div className="report-payment-heading">
        <span className="report-payment-heading-icon">
          <Banknote size={21} aria-hidden="true" />
        </span>
        <div>
          <h3 id="report-payment-heading">Gastos por forma de pagamento</h3>
          <p>Selecione uma forma para ver as compras pagas no período.</p>
        </div>
      </div>
      <ul className="report-method-list">
        {methods.map(({ method, total }) => {
          const key = method ?? "unknown";
          const label = method ? paymentMethodLabels[method] : "Não informada";
          const Icon = method ? methodIcons[method] : CircleHelp;
          const open = selected === key;
          const panelId = "report-payment-purchases-" + key;
          const params = new URLSearchParams(query);
          params.set("payment_method", key);
          return (
            <li key={key} className="report-method-item" data-open={open}>
              <button
                type="button"
                className="report-method-button"
                aria-label={"Ver compras: " + label}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() =>
                  setSelected((current) => (current === key ? null : key))
                }
              >
                <span
                  className="report-method-icon report-color-icon"
                  style={method ? badgeStyle(paymentColors[method]) : undefined}
                >
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="report-method-name">{label}</span>
                <strong className="report-method-value">{money(total)}</strong>
                <ChevronDown
                  className="report-method-chevron"
                  size={17}
                  aria-hidden="true"
                />
              </button>
              <div className="report-detail-panel" id={panelId} hidden={!open}>
                {open && (
                  <ReportPurchases
                    key={params.toString()}
                    query={params.toString()}
                    heading={
                      method
                        ? "Compras com " + label
                        : "Compras sem forma de pagamento informada"
                    }
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
