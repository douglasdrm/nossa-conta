"use client";

import { useEffect, useState } from "react";
import type { AnnualReport } from "@/lib/finance-reports";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});
const money = (amount: number) => currency.format(amount / 100);
const date = (value: string) => value.split("-").reverse().join("/");

function variation(current: number, previous: number, hasHistory: boolean) {
  if (!hasHistory) return "Sem histórico";
  if (previous === 0) return "Novo no período";
  if (current === previous) return "Igual";
  const change = current - previous;
  return `${change > 0 ? "Subiu" : "Caiu"} ${percent.format(Math.abs(change / previous))} (${money(Math.abs(change))})`;
}

const monthName = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  timeZone: "UTC",
});
const monthLabel = (value: string) =>
  monthName
    .format(new Date(value.slice(0, 7) + "-01T12:00:00Z"))
    .replace(".", "");

function variationClass(current: number, previous: number, history: boolean) {
  if (!history || current === previous || previous === 0) return "variation";
  return current > previous ? "variation increased" : "variation decreased";
}

export default function AnnualSpending({ today }: { today: string }) {
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [mode, setMode] = useState<"monthly" | "annual">("monthly");
  const [month, setMonth] = useState(today.slice(0, 7));
  const monthly = mode === "monthly";
  const monthCount = year === currentYear ? Number(today.slice(5, 7)) : 12;
  const [report, setReport] = useState<AnnualReport | null>(null);
  const [series, setSeries] = useState<AnnualReport["months"]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setReport(null);
    setError(false);
    fetch(
      "/api/reports/annual?year=" + year + (monthly ? "&month=" + month : ""),
      { signal: abort.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result: AnnualReport = await response.json();
        if (!abort.signal.aborted) {
          setReport(result);
          if (result.months) setSeries(result.months);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [year, today, retry, monthly, month]);

  const hasHistory = Boolean(report?.previousTotal);
  const currentLabel = monthly ? monthLabel(month) : String(year);
  const previousLabel =
    report && monthly
      ? monthLabel(report.periods.previous.start)
      : String(year - 1);
  const visibleMonths =
    monthly && series?.[0]?.month.startsWith(`${year}-`) ? series : [];
  const maxMonth = Math.max(1, ...visibleMonths.map((item) => item.total));

  return (
    <section className="panel annual-report" aria-labelledby="annual-heading">
      <div className="annual-heading">
        <div>
          <h2 id="annual-heading">Gastos por categoria</h2>
          <p>Despesas confirmadas, pela data do lançamento.</p>
        </div>
        <div className="report-pickers">
          <label>
            Ano
            <select
              value={year}
              onChange={(event) => {
                const selected = Number(event.target.value);
                setReport(null);
                setYear(selected);
                setMonth(
                  selected === currentYear
                    ? today.slice(0, 7)
                    : `${selected}-12`,
                );
              }}
            >
              {Array.from(
                { length: currentYear - 1999 },
                (_, i) => currentYear - i,
              ).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {monthly && (
            <label>
              Mês
              <select
                value={month}
                onChange={(event) => {
                  setReport(null);
                  setMonth(event.target.value);
                }}
              >
                {Array.from(
                  { length: monthCount },
                  (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`,
                ).map((value) => (
                  <option key={value} value={value}>
                    {monthLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      <div
        className="report-modes"
        role="group"
        aria-label="Período do relatório"
      >
        <button
          type="button"
          aria-pressed={monthly}
          onClick={() => {
            if (!monthly) {
              setReport(null);
              setMode("monthly");
            }
          }}
        >
          Mês a mês
        </button>
        <button
          type="button"
          aria-pressed={!monthly}
          onClick={() => {
            if (monthly) {
              setReport(null);
              setMode("annual");
            }
          }}
        >
          Ano a ano
        </button>
      </div>
      {visibleMonths.length > 0 && (
        <div
          className="monthly-series"
          aria-label={`Gasto total por mês em ${year}`}
        >
          {visibleMonths.map((item) => (
            <button
              type="button"
              key={item.month}
              aria-pressed={item.month === month}
              onClick={() => {
                if (item.month !== month) {
                  setReport(null);
                  setMonth(item.month);
                }
              }}
            >
              <span>{monthLabel(item.month)}</span>
              <strong>{money(item.total)}</strong>
              <span className="month-bar" aria-hidden="true">
                <i style={{ width: `${(100 * item.total) / maxMonth}%` }} />
              </span>
            </button>
          ))}
        </div>
      )}
      {error ? (
        <p className="error" role="alert">
          Não foi possível carregar o relatório.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Tentar novamente
          </button>
        </p>
      ) : !report ? (
        <p role="status">Carregando relatório…</p>
      ) : (
        <>
          <div className="report-periods">
            <div>
              <span>Total gasto em {currentLabel}</span>
              <strong>{money(report.total)}</strong>
              <small>
                {date(report.periods.current.start)} a{" "}
                {date(report.periods.current.end)}
              </small>
            </div>
            <div>
              <span>
                {monthly ? "Mês anterior" : `Mesmo período de ${year - 1}`}
              </span>
              <strong>
                {hasHistory ? money(report.previousTotal) : "Sem histórico"}
              </strong>
              <small>
                {date(report.periods.previous.start)} a{" "}
                {date(report.periods.previous.end)}
              </small>
            </div>
          </div>
          {hasHistory && (
            <p className="annual-delta">
              Comparação do total ·{" "}
              <strong>
                {variation(report.total, report.previousTotal, true)}
              </strong>
            </p>
          )}
          {!report.categories.length ? (
            <p>Nenhuma despesa paga nos períodos selecionados.</p>
          ) : (
            <div className="table-wrap annual-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Categoria</th>
                    <th scope="col" className="amount">
                      {currentLabel}
                    </th>
                    <th scope="col" className="amount">
                      {previousLabel}
                    </th>
                    <th scope="col">Variação</th>
                  </tr>
                </thead>
                <tbody>
                  {report.categories.map((category) => (
                    <tr key={category.name}>
                      <th scope="row">{category.name}</th>
                      <td className="amount">{money(category.current)}</td>
                      <td className="amount">
                        {hasHistory ? money(category.previous) : "—"}
                      </td>
                      <td>
                        <span
                          className={variationClass(
                            category.current,
                            category.previous,
                            hasHistory,
                          )}
                        >
                          {variation(
                            category.current,
                            category.previous,
                            hasHistory,
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
