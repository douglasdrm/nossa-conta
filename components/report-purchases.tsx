"use client";
import { useEffect, useState } from "react";
import { paymentMethodLabels, type PaymentMethod } from "@/lib/payment-methods";
const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const money = (amount: number) => currency.format(amount / 100);
const date = (value: string) => value.split("-").reverse().join("/");

type PurchaseDetail = {
  entries: {
    id: string;
    description: string;
    category: string;
    amount: number;
    date: string;
    payment_method: PaymentMethod | null;
    installment_number: number | null;
    installment_count: number | null;
  }[];
  period: { start: string; end: string };
};

export default function ReportPurchases({
  query,
  heading,
  showPaymentMethod = false,
}: {
  query: string;
  heading: string;
  showPaymentMethod?: boolean;
}) {
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError(false);
    fetch("/api/reports/annual?" + query, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        const result: PurchaseDetail = await response.json();
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [query, retry]);
  return (
    <section className="report-payment-purchases" aria-label={heading}>
      <div className="report-purchases-heading">
        {detail && (
          <p>
            Lançamentos pagos · {date(detail.period.start)} a{" "}
            {date(detail.period.end)}
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
          Nenhuma despesa paga encontrada neste período.
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
                    {showPaymentMethod && (
                      <span>
                        {entry.payment_method
                          ? paymentMethodLabels[entry.payment_method]
                          : "Forma de pagamento não informada"}
                      </span>
                    )}
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
