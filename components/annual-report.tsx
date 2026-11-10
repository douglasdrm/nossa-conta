"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Equal,
  Wallet,
} from "lucide-react";
import { paymentMethodLabels, type PaymentMethod } from "@/lib/payment-methods";
import PaymentMethodReport from "@/components/payment-method-report";
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
  entries: {
    id: string;
    description: string;
    amount: number;
    date: string;
    payment_method: PaymentMethod | null;
  }[];
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
                  <time dateTime={entry.date}>
                    {date(entry.date)}
                    {entry.payment_method
                      ? ` · ${paymentMethodLabels[entry.payment_method]}`
                      : ""}
                  </time>
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

const fullMonthName = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const compactCurrency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullMonthLabel = (value: string) =>
  fullMonthName.format(new Date(value.slice(0, 7) + "-01T12:00:00Z"));

function MonthlyChart({
  year,
  month,
  today,
  series,
  onSelect,
}: {
  year: number;
  month: string;
  today: string;
  series: NonNullable<AnnualReport["months"]>;
  onSelect: (month: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const byMonth = new Map(series.map((item) => [item.month, item]));
  const maximum = Math.max(
    1,
    ...series.map((item) => item.total + item.pending),
  );
  useEffect(() => {
    const scroller = scrollRef.current;
    const selected = scroller?.querySelector<HTMLElement>(
      '[data-month="' + month + '"]',
    );
    if (!scroller || !selected) return;
    const centerSelectedMonth = () => {
      const button = selected.getBoundingClientRect();
      const frame = scroller.getBoundingClientRect();
      scroller.scrollTo({
        left:
          scroller.scrollLeft +
          button.left -
          frame.left -
          (scroller.clientWidth - button.width) / 2,
        behavior: "instant",
      });
    };
    centerSelectedMonth();
    const observer = new ResizeObserver(centerSelectedMonth);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [month, year, series]);

  return (
    <section className="report-chart" aria-labelledby="report-chart-heading">
      <div className="report-chart-heading">
        <div>
          <h3 id="report-chart-heading">Os gastos ao longo de {year}</h3>
          <p>
            Pago + a pagar em cada mês. Escolha um mês para ver os detalhes.
          </p>
        </div>
        <div className="report-legend" aria-label="Legenda do gráfico">
          <span>
            <i className="report-legend-paid" />
            Já foi pago
          </span>
          <span>
            <i className="report-legend-pending" />A pagar
          </span>
        </div>
      </div>
      <div
        className="report-chart-scroll"
        ref={scrollRef}
        role="group"
        aria-label={"Gastos por mês em " + year}
      >
        <div className="report-chart-grid">
          {Array.from({ length: 12 }, (_, index) => {
            const key = year + "-" + String(index + 1).padStart(2, "0");
            const item = byMonth.get(key);
            const future = key > today.slice(0, 7);
            const empty = !item || item.count === 0;
            const total = (item?.total ?? 0) + (item?.pending ?? 0);
            const description = future
              ? fullMonthLabel(key) + ": mês futuro"
              : empty
                ? fullMonthLabel(key) + ": sem registros"
                : fullMonthLabel(key) +
                  ": " +
                  money(total) +
                  " previstos, " +
                  money(item.total) +
                  " pagos e " +
                  money(item.pending) +
                  " a pagar";
            return (
              <button
                key={key}
                type="button"
                className="report-month-button"
                data-month={key}
                aria-label={description}
                title={description}
                aria-pressed={month === key}
                disabled={future || !item}
                onClick={() => onSelect(key)}
              >
                <strong className="report-month-total">
                  {empty || future ? "—" : compactCurrency.format(total / 100)}
                </strong>
                <span className="report-chart-column" aria-hidden="true">
                  {empty || future ? (
                    <span className="report-chart-empty" />
                  ) : (
                    <>
                      <span
                        className="report-chart-pending"
                        style={{
                          height: (100 * item.pending) / maximum + "%",
                          minHeight: item.pending ? 2 : 0,
                        }}
                      />
                      <span
                        className="report-chart-paid"
                        style={{
                          height: (100 * item.total) / maximum + "%",
                          minHeight: item.total ? 2 : 0,
                        }}
                      />
                    </>
                  )}
                </span>
                <span className="report-month-caption">
                  <span>{monthLabel(key)}</span>
                  <small>
                    {future
                      ? "Futuro"
                      : empty
                        ? "Sem registros"
                        : item.count +
                          (item.count === 1 ? " gasto" : " gastos")}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="report-chart-mobile-hint">
        Deslize para ver os outros meses.
      </p>
    </section>
  );
}

export default function AnnualSpending({ today }: { today: string }) {
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [mode, setMode] = useState<"monthly" | "annual">("monthly");
  const [month, setMonth] = useState(today.slice(0, 7));
  const monthly = mode === "monthly";
  const [report, setReport] = useState<AnnualReport | null>(null);
  const [series, setSeries] = useState<AnnualReport["months"]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<{
    category: string;
    period: "current" | "previous";
  } | null>(null);

  function selectMonth(value: string) {
    if (
      !value ||
      value < "2000-01" ||
      value > today.slice(0, 7) ||
      value === month
    )
      return;
    setReport(null);
    setSelected(null);
    setMonth(value);
    setYear(Number(value.slice(0, 4)));
  }
  function moveMonth(offset: number) {
    const value = new Date(month + "-15T12:00:00Z");
    value.setUTCMonth(value.getUTCMonth() + offset);
    selectMonth(value.toISOString().slice(0, 7));
  }
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

  const hasHistory = Boolean(report?.previousPaidCount);
  const currentLabel = monthly ? monthLabel(month) : String(year);
  const previousLabel =
    report && monthly
      ? monthLabel(report.periods.previous.start)
      : String(year - 1);
  const previousFullLabel =
    report && monthly
      ? "em " + fullMonthLabel(report.periods.previous.start)
      : "no mesmo período de " + (year - 1);
  const visibleMonths =
    monthly && series?.[0]?.month.startsWith(year + "-") ? series : [];
  const difference = report ? report.total - report.previousTotal : 0;
  const ComparisonIcon =
    difference > 0 ? ArrowUpRight : difference < 0 ? ArrowDownRight : Equal;

  return (
    <section className="panel annual-report" aria-labelledby="annual-heading">
      <div className="report-heading">
        <span className="eyebrow">CADA ESCOLHA CONTA</span>
        <h2 id="annual-heading">Os gastos da casa, em perspectiva.</h2>
        <p>
          Acompanhe o que já foi pago, o que falta pagar e como cada mês se
          compara aos outros.
        </p>
      </div>
      <div className="report-toolbar">
        <div
          className="report-period-switch"
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
        <div className="report-filter-fields">
          <label>
            Ano
            <select
              aria-label="Ano do relatório"
              value={year}
              onChange={(event) => {
                const value = Number(event.target.value);
                setReport(null);
                setYear(value);
                setMonth(
                  value === currentYear ? today.slice(0, 7) : value + "-12",
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
            <div className="report-month-picker">
              <span>Mês</span>
              <div className="month">
                <button
                  type="button"
                  aria-label="Mês anterior"
                  disabled={month === "2000-01"}
                  onClick={() => moveMonth(-1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <input
                  aria-label="Mês do relatório"
                  type="month"
                  min="2000-01"
                  max={today.slice(0, 7)}
                  value={month}
                  onChange={(event) => selectMonth(event.target.value)}
                />
                <button
                  type="button"
                  aria-label="Próximo mês"
                  disabled={month >= today.slice(0, 7)}
                  onClick={() => moveMonth(1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {!error && visibleMonths.length > 0 && (
        <MonthlyChart
          year={year}
          month={month}
          today={today}
          series={visibleMonths}
          onSelect={selectMonth}
        />
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
          <section
            className="report-selected-period"
            aria-labelledby="report-period-heading"
            aria-live="polite"
          >
            <div className="report-selected-heading">
              <div>
                <h3 id="report-period-heading">
                  {monthly ? fullMonthLabel(month) : year}
                </h3>
                <p>
                  {date(report.periods.current.start)} a{" "}
                  {date(report.periods.current.end)}
                </p>
              </div>
              <CalendarRange size={21} aria-hidden="true" />
            </div>
            <div className="report-summary">
              <article className="report-summary-paid">
                <div>
                  <span>Já foi pago</span>
                  <Check size={19} aria-hidden="true" />
                </div>
                <strong>{money(report.total)}</strong>
                <small>Despesas com pagamento confirmado</small>
              </article>
              <article className="report-summary-pending">
                <div>
                  <span>Ainda falta pagar</span>
                  <Clock3 size={19} aria-hidden="true" />
                </div>
                <strong>{money(report.pendingTotal)}</strong>
                <small>Despesas que continuam pendentes</small>
              </article>
              <article className="report-summary-forecast">
                <div>
                  <span>Total previsto</span>
                  <Wallet size={19} aria-hidden="true" />
                </div>
                <strong>{money(report.total + report.pendingTotal)}</strong>
                <small>Soma do que foi pago e do que falta pagar</small>
              </article>
            </div>
            <p
              className={
                "report-comparison " +
                (hasHistory
                  ? difference > 0
                    ? "increased"
                    : difference < 0
                      ? "decreased"
                      : ""
                  : "")
              }
            >
              {hasHistory ? (
                <ComparisonIcon size={18} aria-hidden="true" />
              ) : (
                <CalendarRange size={18} aria-hidden="true" />
              )}
              <span>
                {hasHistory ? (
                  <>
                    {difference === 0
                      ? "Mesmo valor pago que " + previousFullLabel
                      : money(Math.abs(difference)) +
                        (difference > 0 ? " a mais que " : " a menos que ") +
                        previousFullLabel}
                    . No período anterior:{" "}
                    <strong>{money(report.previousTotal)}</strong> em despesas
                    pagas.
                  </>
                ) : (
                  <>
                    Sem histórico de despesas pagas {previousFullLabel} para
                    comparar.
                  </>
                )}
              </span>
            </p>
          </section>

          {Boolean(report.paymentMethods?.length) && (
            <PaymentMethodReport
              methods={report.paymentMethods ?? []}
              query={new URLSearchParams({
                year: String(year),
                ...(monthly ? { month } : {}),
              }).toString()}
            />
          )}
          <section
            className="report-category-section"
            aria-labelledby="report-categories-heading"
          >
            <div className="report-category-heading">
              <h3 id="report-categories-heading">Gastos pagos por categoria</h3>
              <p>
                Toque na categoria para ver os lançamentos e sua comparação com
                o período anterior.
              </p>
            </div>
            {!report.categories.length ? (
              <p className="report-empty">
                {report.expenseCount > 0
                  ? "Ainda não há pagamentos confirmados neste período. Os valores pendentes aparecem no resumo acima."
                  : "Nenhuma despesa paga nos períodos selecionados."}
              </p>
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
                      <th scope="col">Variação dos gastos pagos</th>
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
                                className="report-category-button"
                                aria-expanded={open}
                                onClick={() =>
                                  open
                                    ? setSelected(null)
                                    : toggleDetails(
                                        category.name,
                                        defaultPeriod,
                                      )
                                }
                              >
                                {category.name}
                                <ChevronDown size={15} aria-hidden="true" />
                              </button>
                            </th>
                            <td className="amount">
                              {money(category.current)}
                            </td>
                            <td className="amount">
                              {category.previous > 0 ? (
                                <button
                                  type="button"
                                  className="text-button"
                                  aria-label={
                                    "Ver gastos anteriores de " + category.name
                                  }
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
          </section>
        </>
      )}
    </section>
  );
}
