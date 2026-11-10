"use client";

import { useState } from "react";
import { ChevronDown, Tag, Tags } from "lucide-react";
import type { AnnualReport } from "@/lib/finance-reports";
import ReportPurchases from "@/components/report-purchases";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const money = (amount: number) => currency.format(amount / 100);
const monthName = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export default function CategorySpendingReport({
  categories,
  periods,
  query,
  hasHistory,
  expenseCount,
}: {
  categories: AnnualReport["categories"];
  periods: AnnualReport["periods"];
  query: string;
  hasHistory: boolean;
  expenseCount: number;
}) {
  const [selected, setSelected] = useState<{
    category: string;
    period: "current" | "previous";
  } | null>(null);
  const monthly = new URLSearchParams(query).has("month");
  const periodLabel = (period: "current" | "previous") =>
    monthly
      ? monthName.format(new Date(periods[period].start + "T12:00:00Z"))
      : periods[period].start.slice(0, 4);
  const previousLabel = monthly
    ? "em " + periodLabel("previous")
    : "no mesmo período de " + periodLabel("previous");
  return (
    <section
      className="report-payment-card report-category-card"
      aria-labelledby="report-categories-heading"
    >
      <div className="report-payment-heading">
        <span className="report-payment-heading-icon">
          <Tags size={21} aria-hidden="true" />
        </span>
        <div>
          <h3 id="report-categories-heading">Gastos pagos por categoria</h3>
          <p>
            Selecione uma categoria para ver as compras e comparar os períodos.
          </p>
        </div>
      </div>
      {!categories.length ? (
        <p className="report-empty">
          {expenseCount > 0
            ? "Ainda não há pagamentos confirmados neste período. Os valores pendentes aparecem no resumo acima."
            : "Nenhuma despesa paga nos períodos selecionados."}
        </p>
      ) : (
        <ul className="report-method-list">
          {categories.map((category, index) => {
            const open = selected?.category === category.name;
            const difference = category.current - category.previous;
            const comparison = !hasHistory
              ? "Sem histórico para comparar"
              : category.previous === 0
                ? "Novo no período"
                : difference === 0
                  ? "Mesmo valor registrado " + previousLabel
                  : money(Math.abs(difference)) +
                    (difference > 0
                      ? " a mais · referência: "
                      : " a menos · referência: ") +
                    periodLabel("previous");
            const params = new URLSearchParams(query);
            params.set("category", category.name);
            params.set("period", selected?.period ?? "current");
            const panelId = "report-category-purchases-" + index;
            return (
              <li
                key={category.name}
                className="report-method-item"
                data-open={open}
              >
                <button
                  type="button"
                  className="report-method-button report-category-header"
                  aria-label={category.name}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() =>
                    setSelected((current) =>
                      current?.category === category.name
                        ? null
                        : {
                            category: category.name,
                            period:
                              category.current > 0 ? "current" : "previous",
                          },
                    )
                  }
                >
                  <span className="report-method-icon report-category-icon">
                    <Tag size={19} aria-hidden="true" />
                  </span>
                  <span className="report-method-name report-category-name">
                    <span className="report-purchase-category">
                      {category.name}
                    </span>
                  </span>
                  <strong className="report-method-value">
                    {money(category.current)}
                  </strong>
                  <span
                    className={
                      "report-method-comparison" +
                      (hasHistory && category.previous > 0 && difference !== 0
                        ? difference > 0
                          ? " increased"
                          : " decreased"
                        : "")
                    }
                  >
                    {comparison}
                  </span>
                  <ChevronDown
                    className="report-method-chevron"
                    size={17}
                    aria-hidden="true"
                  />
                </button>
                <div
                  id={panelId}
                  className="report-detail-panel"
                  hidden={!open}
                >
                  {open && (
                    <>
                      <div
                        className="report-category-periods"
                        role="group"
                        aria-label={
                          "Período dos lançamentos de " + category.name
                        }
                      >
                        {(["current", "previous"] as const).map((period) => (
                          <button
                            type="button"
                            key={period}
                            aria-pressed={selected.period === period}
                            onClick={() =>
                              setSelected({ category: category.name, period })
                            }
                          >
                            {periodLabel(period)} ·{" "}
                            {money(
                              period === "current"
                                ? category.current
                                : category.previous,
                            )}
                          </button>
                        ))}
                      </div>
                      <ReportPurchases
                        key={params.toString()}
                        heading={"Detalhes de " + category.name}
                        query={params.toString()}
                        showPaymentMethod
                      />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
