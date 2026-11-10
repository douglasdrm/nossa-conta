"use client";

import { useEffect, useState } from "react";
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

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const money = (amount: number) => currency.format(amount / 100);
const date = (value: string) => value.split("-").reverse().join("/");
const methodIcons = {
  pix: QrCode,
  cash: Banknote,
  credit_card: CreditCard,
  debit_card: CreditCard,
  bank_slip: Barcode,
  transfer: ArrowRightLeft,
  other: Banknote,
};

type PurchaseDetail = {
  entries: {
    id: string;
    description: string;
    category: string;
    amount: number;
    date: string;
    installment_number: number | null;
    installment_count: number | null;
  }[];
  period: { start: string; end: string };
};

function PaymentPurchases({
  method,
  query,
}: {
  method: PaymentMethod | null;
  query: string;
}) {
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const heading = method
    ? "Compras com " + paymentMethodLabels[method]
    : "Compras sem forma de pagamento informada";
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError(false);
    const params = new URLSearchParams(query);
    params.set("payment_method", method ?? "unknown");
    fetch("/api/reports/annual?" + params, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        const result: PurchaseDetail = await response.json();
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [method, query, retry]);
  return (
    <section className="report-payment-purchases" aria-label={heading}>
      <div className="report-purchases-heading">
        <h4>{heading}</h4>
        {detail && (
          <p>
            {date(detail.period.start)} a {date(detail.period.end)}
          </p>
        )}
      </div>
      {error ? (
        <div className="report-payment-error" role="alert">
          <p>Não foi possível carregar as compras.</p>
          <button
            className="secondary"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : !detail ? (
        <p role="status">Carregando compras…</p>
      ) : detail.entries.length === 0 ? (
        <p className="report-payment-empty">
          Nenhuma despesa paga encontrada para esta forma no período.
        </p>
      ) : (
        <>
          <div className="report-purchases-total">
            <span>
              {detail.entries.length}{" "}
              {detail.entries.length === 1 ? "compra" : "compras"}
            </span>
            <strong>
              {money(
                detail.entries.reduce((sum, entry) => sum + entry.amount, 0),
              )}
            </strong>
          </div>
          <ul className="report-purchase-list">
            {detail.entries.map((entry) => (
              <li key={entry.id} className="report-purchase-row">
                <div>
                  <div className="report-purchase-description">
                    <strong>{entry.description}</strong>
                    {entry.installment_count && (
                      <span className="installment-badge">
                        {entry.installment_number}/{entry.installment_count}
                      </span>
                    )}
                  </div>
                  <div className="report-purchase-meta">
                    <span className="report-purchase-category">
                      {entry.category}
                    </span>
                    <time dateTime={entry.date}>{date(entry.date)}</time>
                  </div>
                </div>
                <strong className="report-purchase-amount">
                  {money(entry.amount)}
                </strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

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
          return (
            <li key={key} className="report-method-item">
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
                <span className="report-method-icon">
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
              <div id={panelId} hidden={!open}>
                {open && (
                  <PaymentPurchases
                    key={query + key}
                    method={method}
                    query={query}
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
