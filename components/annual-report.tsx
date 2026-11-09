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

export default function AnnualSpending({ today }: { today: string }) {
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [report, setReport] = useState<AnnualReport | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setReport(null);
    setError(false);
    fetch("/api/reports/annual?year=" + year, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result: AnnualReport = await response.json();
        if (!abort.signal.aborted) setReport(result);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [year, today, retry]);

  const hasHistory = Boolean(report?.previousTotal);

  return (
    <section className="panel annual-report" aria-labelledby="annual-heading">
      <div className="annual-heading">
        <div>
          <h2 id="annual-heading">Gastos por categoria</h2>
          <p>Despesas confirmadas, pela data do lançamento.</p>
        </div>
        <label>
          Ano
          <select
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          >
            {Array.from(
              { length: currentYear - 1999 },
              (_, i) => currentYear - i,
            ).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
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
              <span>Total gasto em {year}</span>
              <strong>{money(report.total)}</strong>
              <small>
                {date(report.periods.current.start)} a{" "}
                {date(report.periods.current.end)}
              </small>
            </div>
            <div>
              <span>Mesmo período de {year - 1}</span>
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
                      {year}
                    </th>
                    <th scope="col" className="amount">
                      {year - 1}
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
                        {variation(
                          category.current,
                          category.previous,
                          hasHistory,
                        )}
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
