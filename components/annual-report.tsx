"use client";

import { Fragment, useEffect, useState } from "react";
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

type Detail = {
  entries: { id: string; description: string; amount: number; date: string }[];
  period: { start: string; end: string };
};

function CategoryDetail({ name, query }: { name: string; query: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/reports/annual?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        setDetail(await response.json());
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [query]);

  return (
    <section
      className="report-category-detail"
      aria-label={`Detalhes de ${name}`}
    >
      <strong>{name}</strong>
      {error ? (
        <p role="alert">
          Não foi possível carregar os gastos. Feche e abra os detalhes para
          tentar novamente.
        </p>
      ) : !detail ? (
        <p role="status">Carregando gastos…</p>
      ) : (
        <>
          <p>
            {date(detail.period.start)} a {date(detail.period.end)} ·{" "}
            <strong>
              {money(
                detail.entries.reduce((sum, entry) => sum + entry.amount, 0),
              )}
            </strong>
          </p>
          {detail.entries.length ? (
            <ul>
              {detail.entries.map((entry) => (
                <li key={entry.id}>
                  <span>{entry.description}</span>
                  <strong>{money(entry.amount)}</strong>
                  <time dateTime={entry.date}>{date(entry.date)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p>Nenhuma despesa paga nesse período.</p>
          )}
        </>
      )}
    </section>
  );
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
  const [selected, setSelected] = useState<{
    category: string;
    period: "current" | "previous";
  } | null>(null);

  function toggleDetails(category: string, period: "current" | "previous") {
    setSelected((current) =>
      current?.category === category && current.period === period
        ? null
        : { category, period },
    );
  }

  useEffect(() => {
    const abort = new AbortController();
    setReport(null);
    setSelected(null);
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
  const displayMonths = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    return { month: key, total: visibleMonths[index]?.total ?? null };
  });
  const maxMonth = Math.max(1, ...visibleMonths.map((item) => item.total));

  return (
    <section className="panel annual-report" aria-labelledby="annual-heading">
      <div className="annual-heading">
        <div>
          <h2 id="annual-heading">Gastos por categoria</h2>
          <p>
            Despesas pagas, pela data do lançamento. Toque na categoria para ver
            os lançamentos.
          </p>
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
          {displayMonths.map((item) => (
            <button
              type="button"
              key={item.month}
              disabled={item.total === null}
              aria-pressed={item.month === month}
              onClick={() => {
                if (item.month !== month) {
                  setReport(null);
                  setMonth(item.month);
                }
              }}
            >
              <span>{monthLabel(item.month)}</span>
              <strong>
                {item.total === null ? "Futuro" : money(item.total)}
              </strong>
              <span className="month-bar" aria-hidden="true">
                <i
                  style={{ width: `${(100 * (item.total ?? 0)) / maxMonth}%` }}
                />
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
                  {report.categories.map((category) => {
                    const open = selected?.category === category.name;
                    const defaultPeriod =
                      category.current > 0 ? "current" : "previous";
                    const query = new URLSearchParams({
                      year: String(year),
                      category: category.name,
                      period: selected?.period ?? defaultPeriod,
                    });
                    if (monthly) query.set("month", month);
                    return (
                      <Fragment key={category.name}>
                        <tr>
                          <th scope="row">
                            <button
                              type="button"
                              className="text-button"
                              aria-expanded={open}
                              onClick={() =>
                                open
                                  ? setSelected(null)
                                  : toggleDetails(category.name, defaultPeriod)
                              }
                            >
                              {category.name}
                            </button>
                          </th>
                          <td className="amount">{money(category.current)}</td>
                          <td className="amount">
                            {category.previous > 0 ? (
                              <button
                                type="button"
                                className="text-button"
                                aria-label={`Ver gastos anteriores de ${category.name}`}
                                aria-expanded={
                                  open && selected?.period === "previous"
                                }
                                onClick={() =>
                                  toggleDetails(category.name, "previous")
                                }
                              >
                                {money(category.previous)}
                              </button>
                            ) : hasHistory ? (
                              money(0)
                            ) : (
                              "—"
                            )}
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
                        {open && (
                          <tr>
                            <td colSpan={4}>
                              <CategoryDetail
                                key={query.toString()}
                                name={category.name}
                                query={query.toString()}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
