"use client";
import { useEffect, useState, useRef } from "react";
import AnnualSpending from "@/components/annual-report";
import BudgetPlanPanel from "@/components/budget-plan-panel";
import { suggestedBudget, type BudgetPlan } from "@/lib/budget-plan";
import RadarPanel from "@/components/radar-panel";
import type { RadarPattern } from "@/lib/radar";
import UpcomingPanel from "@/components/upcoming-panel";
import { upcomingEnd } from "@/lib/finance-reports";
import SavingsPanel from "@/components/savings-panel";
import { expenseCategories, incomeCategories } from "@/lib/categories";
import CategoryPicker from "@/components/category-picker";
import SharePanel from "@/components/share-panel";
import MoneyInput from "@/components/money-input";
import DuePanel from "@/components/due-panel";
import {
  dateInSaoPaulo,
  moneyInputToCents,
  monthForecast,
  installmentAmounts,
  type InstallmentMode,
  paymentState,
} from "@/lib/finance";
import {
  Wallet,
  Banknote,
  LayoutDashboard,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  X,
  Pencil,
  Repeat2,
  Trash2,
  Users,
  ChevronLeft,
  ChevronRight,
  Download,
  Leaf,
  Menu,
  PiggyBank,
  UserRound,
  TriangleAlert,
  CalendarRange,
  SlidersHorizontal,
} from "lucide-react";
type Entry = {
  id: string;
  kind: string;
  description: string;
  amount: number;
  category: string;
  person: string;
  date: string;
  confirmed: boolean;
  payer: string | null;
  payer_user_id?: string | null;
  payer_display?: string | null;
  confirmed_at: string | null;
  installment_group: string | null;
  installment_number: number | null;
  installment_count: number | null;
};
const colors = [
  "#286653",
  "#d9a65d",
  "#8b9dcd",
  "#d47763",
  "#9ba970",
  "#69a6aa",
  "#c68eac",
  "#a29685",
  "#728593",
  "#c7bfab",
];
const money = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    n / 100,
  );
const today = dateInSaoPaulo;
export type FinanceView =
  | "overview"
  | "savings"
  | "entries"
  | "annual"
  | "plan";

export default function Dashboard({
  name,
  photo,
  view = "overview",
  initialMonth,
}: {
  name: string;
  photo?: string;
  view?: FinanceView;
  initialMonth?: string;
}) {
  const overview = view === "overview";
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [planError, setPlanError] = useState(false);
  const [radar, setRadar] = useState<{
    buffer: number;
    patterns: RadarPattern[];
  } | null>(null);
  const [upcoming, setUpcoming] = useState<Entry[]>([]);
  const [upcomingError, setUpcomingError] = useState(false);
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [paymentMode, setPaymentMode] = useState(false),
    [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [data, setData] = useState<Entry[]>([]),
    [month, setMonth] = useState(initialMonth ?? today().slice(0, 7)),
    [modal, setModal] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all"),
    [person, setPerson] = useState("Todos"),
    [query, setQuery] = useState("");
  const [due, setDue] = useState<Entry[]>([]),
    [day, setDay] = useState(today());
  const [categoryPending, setCategoryPending] = useState(false);
  const requestId = useRef(0);
  const installmentGroup = useRef("");
  const [expenseMode, setExpenseMode] = useState("single");
  const [installmentMode, setInstallmentMode] =
    useState<InstallmentMode>("total");
  const [installmentCount, setInstallmentCount] = useState(3);
  const [inputAmount, setInputAmount] = useState(0);
  useEffect(() => {
    setExpenseMode("single");
    setInstallmentMode("total");
    setInstallmentCount(3);
    setInputAmount(editing?.amount || 0);
    installmentGroup.current = crypto.randomUUID();
  }, [modal, editing?.id]);
  const isInstallment =
    modal === "expense" && !editing && expenseMode === "installment";
  const installmentPreview = isInstallment
    ? installmentAmounts(inputAmount, installmentCount, installmentMode)
    : null;
  useEffect(() => {
    setPaymentConfirmed(paymentMode || Boolean(editing?.confirmed));
  }, [modal, editing?.id, editing?.confirmed, paymentMode]);
  useEffect(() => {
    const timer = setInterval(() => setDay(today()), 30000);
    return () => clearInterval(timer);
  }, []);
  async function reload(target = month) {
    if (view === "annual") return;
    const seq = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const now = today();
      const months = overview
        ? [...new Set([target, now.slice(0, 7), upcomingEnd(now).slice(0, 7)])]
        : [target];
      const syncs = await Promise.all(
        months.map((m) =>
          fetch("/api/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "sync", month: m }),
          }),
        ),
      );
      if (syncs.some((r) => !r.ok)) throw Error();
      const [r, alerts, soon, history, planResponse] = await Promise.all([
        fetch("/api/entries?month=" + encodeURIComponent(target)),
        overview ? fetch("/api/entries?due=true") : null,
        overview ? fetch("/api/entries?upcoming=true").catch(() => null) : null,
        overview && target === now.slice(0, 7)
          ? fetch("/api/reports/radar").catch(() => null)
          : null,
        (view === "plan" && plan === null) ||
        (overview && target === now.slice(0, 7))
          ? fetch("/api/budget-plan").catch(() => null)
          : null,
      ]);
      if (!r.ok || (alerts && !alerts.ok)) throw Error();
      const [records, reminders, commitments, radarContext, budget] =
        await Promise.all([
          r.json(),
          alerts ? alerts.json() : [],
          soon?.ok ? soon.json().catch(() => null) : null,
          history?.ok ? history.json().catch(() => null) : null,
          planResponse?.ok ? planResponse.json().catch(() => null) : null,
        ]);
      if (seq === requestId.current) {
        setData(records);
        setRadar(radarContext);
        if (view !== "plan" || plan === null) {
          setPlan(budget);
          setPlanError(view === "plan" && !budget);
        }
        setDue(reminders);
        setUpcoming(commitments ?? []);
        setUpcomingError(overview && commitments === null);
      }
    } catch {
      if (seq === requestId.current) {
        setUpcomingError(overview);
        setError(
          "Não foi possível carregar os registros. Tente atualizar a página.",
        );
      }
    } finally {
      if (seq === requestId.current) setLoading(false);
    }
  }
  useEffect(() => {
    reload(month);
  }, [month, day]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") reload(month);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [month]);

  const rows = loading ? [] : data.filter((e) => e.date.startsWith(month)),
    totals = monthForecast(rows),
    planSuggestion =
      overview && plan && !loading && !error && month === day.slice(0, 7)
        ? suggestedBudget(totals.totalIncome, rows, plan)
        : null,
    income = totals.income,
    expense = totals.paid,
    pending = totals.pending,
    groups = [
      ...new Set([
        ...expenseCategories,
        ...rows.filter((e) => e.kind === "expense").map((e) => e.category),
      ]),
    ]
      .map((c, i) => ({
        name: c,
        color: colors[i % colors.length],
        value: rows
          .filter(
            (e) => e.kind === "expense" && e.confirmed && e.category === c,
          )
          .reduce((a, e) => a + e.amount, 0),
      }))
      .filter((c) => c.value)
      .sort((a, b) => b.value - a.value),
    people = [
      ...new Set([
        name,
        ...data
          .flatMap((e) => [e.person, e.payer_display || e.payer])
          .filter((p): p is string => Boolean(p)),
      ]),
    ];
  const payerTotals = new Map<string, { label: string; total: number }>();
  for (const entry of rows) {
    if (entry.kind !== "expense" || !entry.confirmed) continue;
    const label = entry.payer_display || entry.payer || "Não informado";
    const key = entry.payer_user_id || `label:${entry.payer || ""}`;
    payerTotals.set(key, {
      label,
      total: (payerTotals.get(key)?.total || 0) + entry.amount,
    });
  }
  const paidBy = [...payerTotals].sort((a, b) => b[1].total - a[1].total);
  const shown = rows
    .filter(
      (e) =>
        (filter === "all" ||
          e.kind === filter ||
          (filter === "pending" && e.kind === "expense" && !e.confirmed) ||
          (filter === "paid" && e.kind === "expense" && e.confirmed)) &&
        (person === "Todos" || e.person === person) &&
        e.description.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  function move(n: number) {
    const d = new Date(month + "-15T12:00:00");
    d.setMonth(d.getMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  }
  async function save(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (busy || categoryPending) return;
    setBusy(true);
    setError("");
    const f = new FormData(ev.currentTarget);
    try {
      const amount = moneyInputToCents(String(f.get("amount")));
      const r = await fetch("/api/entries", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...Object.fromEntries(f),
          kind: modal,
          amount,
          confirmed: f.get("paymentStatus") === "confirmed",
          payer:
            modal === "expense" && f.get("paymentStatus") === "confirmed"
              ? String(f.get("payer") || name).trim()
              : undefined,
          id: editing?.id,
          repeats:
            !editing && modal === "expense" && expenseMode === "recurring",
          ...(isInstallment
            ? {
                installmentCount,
                installmentMode,
                installmentGroup: installmentGroup.current,
              }
            : {}),
          future: f.get("future") === "on",
        }),
      });
      if (!r.ok) {
        const b = await r.json();
        throw Error(b.error);
      }
      setMonth(String(f.get("date")).slice(0, 7));
      setModal("");
      setEditing(null);
      setPaymentMode(false);
      await reload(String(f.get("date")).slice(0, 7));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível salvar. Confira os campos e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  function confirmPayment(id: string) {
    const e = [...data, ...due].find((e) => e.id === id);
    if (!e || busy) return;
    setEditing(e);
    setError("");
    setPaymentMode(true);
    setPaymentConfirmed(true);
    setModal(e.kind);
  }
  function editDue(id: string) {
    const e = due.find((e) => e.id === id);
    if (!e) return;
    setEditing(e);
    setPaymentMode(false);
    setError("");
    setModal("expense");
  }
  async function remove(id: string) {
    if (
      !confirm(
        "Excluir este lançamento? Em contas recorrentes ou parceladas, apenas este lançamento será excluído.",
      )
    )
      return;
    try {
      const r = await fetch("/api/entries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw Error();
      await reload();
    } catch {
      setError("Não foi possível excluir. Tente novamente.");
    }
  }
  function exportCsv() {
    const text =
      "\uFEFFData;Descrição;Tipo;Categoria;Pessoa;Valor;Situação;Pago por\n" +
      rows
        .map((e) =>
          [
            e.date,
            e.description +
              (e.installment_count
                ? ` (${e.installment_number}/${e.installment_count})`
                : ""),
            e.kind === "income" ? "Entrada" : "Saída",
            e.category,
            e.person,
            (e.amount / 100).toFixed(2).replace(".", ","),
            e.kind === "income"
              ? e.confirmed
                ? "Recebido"
                : "A receber"
              : e.confirmed
                ? "Pago"
                : "Pendente",
            e.kind === "expense" && e.confirmed
              ? e.payer_display || e.payer || "Não informado"
              : "",
          ]
            .map((x) => '"' + x.replaceAll('"', '""') + '"')
            .join(";"),
        )
        .join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `nossa-conta-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const monthPicker = (
    <div className="month">
      <button aria-label="Mês anterior" onClick={() => move(-1)}>
        <ChevronLeft size={18} />
      </button>
      <input
        aria-label="Mês"
        type="month"
        min="2000-01"
        max="2099-12"
        value={month}
        onChange={(e) => e.target.value && setMonth(e.target.value)}
      />
      <button aria-label="Próximo mês" onClick={() => move(1)}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
  const entryActions = (
    <div className="actionbar">
      <span>
        Uma compra, um Pix, um salário. <b>Registre aqui.</b>
      </span>
      <div>
        <button
          className="secondary"
          onClick={() => {
            setError("");
            setEditing(null);
            setPaymentMode(false);
            setModal("income");
          }}
        >
          <Plus size={17} /> Adicionar entrada
        </button>
        <button
          className="primary"
          onClick={() => {
            setError("");
            setEditing(null);
            setPaymentMode(false);
            setModal("expense");
          }}
        >
          <Plus size={17} /> Adicionar gasto
        </button>
      </div>
    </div>
  );
  const records = (
    <section id="records" className="panel records">
      <div className="panel-title">
        <div>
          <h2>Lançamentos do mês</h2>
          <span>Tudo em um lugar, sem perder os detalhes.</span>
        </div>
        <button className="export" disabled={!rows.length} onClick={exportCsv}>
          <Download size={15} /> Exportar
        </button>
      </div>
      <div className="filters">
        <div className="tabs">
          {[
            ["all", "Todos"],
            ["expense", "Gastos"],
            ["income", "Entradas"],
            ["pending", "A pagar"],
            ["paid", "Pagos"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={filter === v ? "selected" : ""}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <input
          aria-label="Buscar lançamento"
          placeholder="Buscar lançamento..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Pessoa"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        >
          <option>Todos</option>
          {people.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>
                Responsável
                <br />
                Pago por
              </th>
              <th>Data / vencimento</th>
              <th>Situação</th>
              <th className="amount">Valor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id}>
                <td>
                  <span className={`row-icon ${e.kind}`}>
                    {e.kind === "income" ? (
                      <ArrowDownLeft size={16} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}
                  </span>
                  <b>{e.description}</b>
                  {e.installment_count && (
                    <span className="installment-badge">
                      {e.installment_number}/{e.installment_count}
                    </span>
                  )}
                  {e.id.includes(":") && (
                    <span title="Despesa recorrente" className="recurring-mark">
                      <Repeat2 size={12} />
                    </span>
                  )}
                </td>
                <td>
                  <span className="pill">{e.category}</span>
                </td>
                <td>
                  <span className="entry-responsible">{e.person}</span>
                  <small className="entry-payer">
                    {e.kind === "expense" && e.confirmed
                      ? e.payer_display || e.payer || "Não informado"
                      : "—"}
                  </small>
                </td>
                <td>{e.date.split("-").reverse().join("/")}</td>
                <td>
                  <span className={"status-pill " + paymentState(e, day)}>
                    {
                      {
                        received: "Recebido",
                        expected: "A receber",
                        paid: "Pago",
                        pending: "Pendente",
                        due: "Vence hoje",
                        overdue: "Vencido",
                      }[paymentState(e, day)]
                    }
                  </span>
                </td>
                <td className={`amount ${e.kind}`}>
                  {e.kind === "income" ? "+" : "−"} {money(e.amount)}
                </td>
                <td>
                  <div className="entry-actions">
                    <button
                      className="confirm-payment"
                      disabled={busy || e.confirmed}
                      title={
                        e.kind === "income"
                          ? "Confirmar recebimento"
                          : "Confirmar pagamento"
                      }
                      aria-label={`${e.kind === "income" ? "Confirmar recebimento" : "Confirmar pagamento"}: ${e.description}`}
                      onClick={() => confirmPayment(e.id)}
                    >
                      <Banknote size={15} aria-hidden="true" />
                    </button>
                    <button
                      className="delete"
                      aria-label={`Editar ${e.description}`}
                      onClick={() => {
                        setEditing(e);
                        setPaymentMode(false);
                        setError("");
                        setModal(e.kind);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      aria-label={`Excluir ${e.description}`}
                      className="delete"
                      onClick={() => remove(e.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length && (
        <div className="empty">
          <Wallet size={28} />
          <h3>
            {loading
              ? "Carregando..."
              : rows.length
                ? "Nenhum resultado por aqui."
                : "O mês está pronto para começar."}
          </h3>
          <p>
            {rows.length
              ? "Experimente mudar os filtros."
              : "Adicione uma entrada ou um gasto para ver o resumo da casa."}
          </p>
          {!rows.length && !loading && (
            <button
              onClick={() => {
                setEditing(null);
                setPaymentMode(false);
                setModal("expense");
              }}
              className="text-button"
            >
              + Fazer primeiro lançamento
            </button>
          )}
        </div>
      )}
      <footer>
        {shown.length} lançamento{shown.length !== 1 ? "s" : ""}
        <span>Organizar juntos faz a diferença.</span>
      </footer>
    </section>
  );
  const navigation = (
    <>
      <a
        className={overview ? "nav active" : "nav"}
        href="/"
        aria-current={overview ? "page" : undefined}
      >
        <LayoutDashboard size={19} /> Visão geral
      </a>
      <a
        className={view === "entries" ? "nav active" : "nav"}
        href={`/lancamentos?mes=${month}`}
        aria-current={view === "entries" ? "page" : undefined}
      >
        <ArrowUpRight size={19} /> Lançamentos
      </a>
      <a
        className={view === "savings" ? "nav active" : "nav"}
        href="/caixinhas"
        aria-current={view === "savings" ? "page" : undefined}
      >
        <PiggyBank size={19} /> Caixinhas
      </a>
      <a
        className={view === "annual" ? "nav active" : "nav"}
        href="/relatorio-anual"
        aria-current={view === "annual" ? "page" : undefined}
      >
        <CalendarRange size={19} /> Relatórios
      </a>
      <button
        className="nav"
        onClick={() => {
          mobileMenu.current?.removeAttribute("open");
          setModal("share");
        }}
      >
        <Users size={19} /> Compartilhar
      </button>
      <a className="nav" href="/profile">
        <UserRound size={19} /> Meu perfil
      </a>
    </>
  );
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          <span>
            <Wallet size={24} />
          </span>
          Nossa Conta<span className="dot">.</span>
        </a>
        <div className="home-label">ESPAÇO DA FAMÍLIA</div>
        {navigation}
        <div className="aside-note">
          <Leaf size={25} />
          <h3>
            Pequenos hábitos.
            <br />
            Mais tranquilidade.
          </h3>
          <p>Entender o presente é o primeiro passo para planejar juntos.</p>
        </div>
        <div className="profile">
          <a
            href="/profile"
            className="profile-avatar-link"
            aria-label="Editar meu perfil"
          >
            {photo ? (
              <img src={photo} alt="" width={36} height={36} />
            ) : (
              <span>{name[0]}</span>
            )}
          </a>
          <div>
            {name}
            <small>Finanças da casa</small>
          </div>
          <form action="/auth/signout" method="post">
            <button className="signout" title="Sair da conta">
              Sair
            </button>
          </form>
        </div>
      </aside>
      <main>
        <header>
          <details
            className="mobile-menu"
            ref={mobileMenu}
            onKeyDown={(event) => {
              if (event.key === "Escape" && event.currentTarget.open) {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary>
              <Menu size={19} aria-hidden="true" /> Menu
            </summary>
            <nav className="mobile-menu-links" aria-label="Menu principal">
              {navigation}
              <form action="/auth/signout" method="post">
                <button className="nav" type="submit">
                  Sair da conta
                </button>
              </form>
            </nav>
          </details>
          <div className="breadcrumb">
            Nosso espaço <span>/</span>{" "}
            {
              {
                savings: "Caixinhas",
                overview: "Visão geral",
                entries: "Lançamentos",
                annual: "Relatórios",
                plan: "Plano do mês",
              }[view]
            }
          </div>
          <a className="profile-header-link" href="/profile">
            <UserRound size={16} /> Meu perfil
          </a>
          <button className="share" onClick={() => setModal("share")}>
            <Users size={16} /> Espaço compartilhado
          </button>
        </header>
        {view === "annual" ? (
          <>
            <section className="heading">
              <div>
                <a className="text-button" href="/">
                  Voltar para visão geral
                </a>
                <h1>Relatórios</h1>
              </div>
            </section>
            <AnnualSpending today={day} />
          </>
        ) : view === "entries" ? (
          <>
            <section className="heading">
              <div>
                <a className="text-button" href="/">
                  Voltar para visão geral
                </a>
                <h1>Lançamentos</h1>
              </div>
              {monthPicker}
            </section>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            {entryActions}
            {records}
          </>
        ) : view === "plan" ? (
          <>
            <section className="heading">
              <div>
                <a className="text-button" href="/">
                  Voltar para visão geral
                </a>
                <h1>Plano do mês</h1>
              </div>
              {monthPicker}
            </section>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            {plan ? (
              <BudgetPlanPanel
                plan={plan}
                income={totals.totalIncome}
                entries={rows}
                balancesLoading={loading || Boolean(error)}
                onSave={setPlan}
              />
            ) : planError ? (
              <p role="alert">
                Não foi possível carregar o plano.{" "}
                <button className="text-button" onClick={() => reload()}>
                  Tentar novamente
                </button>
              </p>
            ) : !error ? (
              <p role="status">Carregando plano…</p>
            ) : null}
          </>
        ) : view === "savings" ? (
          <>
            <section className="heading">
              <div>
                <a className="text-button" href="/">
                  Voltar para visão geral
                </a>
                <h1>Metas da casa</h1>
              </div>
              {monthPicker}
            </section>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <SavingsPanel
              month={month}
              today={day}
              income={income}
              expenses={totals.totalExpense}
              balancesLoading={loading || Boolean(error)}
            />
          </>
        ) : (
          <>
            <section className="heading">
              <div>
                <p className="eyebrow">CADA ESCOLHA CONTA</p>
                <h1>O dinheiro da casa, às claras.</h1>
                <p>Mais organização hoje. Mais planos juntos amanhã.</p>
              </div>
              {monthPicker}
            </section>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <section className="stats">
              <article className="balance">
                <div>
                  Saldo atual do mês <Wallet size={20} />
                </div>
                <strong>{income ? money(income - expense) : "—"}</strong>
                <small>
                  {income
                    ? "Receitas recebidas menos gastos pagos"
                    : "Renda opcional. Informe se quiser calcular o saldo."}
                </small>
                <div className="balance-line" />
              </article>
              <article className="income-card">
                <div>
                  Entrou{" "}
                  <span className="icon income">
                    <ArrowDownLeft size={18} />
                  </span>
                </div>
                <strong className={!income ? "no-income" : ""}>
                  {income ? money(income) : "Não informada"}
                </strong>
                <small>
                  {totals.pendingIncome
                    ? `${money(totals.pendingIncome)} a receber`
                    : "Opcional · salários e outras receitas"}
                </small>
              </article>
              <article className="expense-card">
                <div>
                  Pago{" "}
                  <span className="icon expense">
                    <ArrowUpRight size={18} />
                  </span>
                </div>
                <strong>{money(expense)}</strong>
                <small>
                  {income
                    ? `${Math.round((expense / income) * 100)}% da renda do mês`
                    : "Seus gastos pagos neste mês"}
                </small>
              </article>
              <article className="pending-card">
                <div>
                  A pagar <Repeat2 size={19} />
                </div>
                <strong>{money(pending)}</strong>
                <small>
                  {income
                    ? `Saldo após pagar: ${money(income - expense - pending)}`
                    : "Só entra no pago quando confirmar"}
                </small>
              </article>
            </section>
            <section
              className={`forecast ${!loading && totals.projected < 0 ? "forecast-negative" : ""}`}
              aria-label="Previsão do mês"
            >
              <div className="forecast-heading">
                <CalendarRange size={22} aria-hidden="true" />
                <div>
                  <h2>Saldo previsto do mês</h2>
                  <p>
                    Receitas e gastos lançados no mês, incluindo os pendentes.
                  </p>
                </div>
              </div>
              <strong className="forecast-value">
                {loading ? "—" : money(totals.projected)}
              </strong>
              <p className="forecast-calculation">
                {loading
                  ? "Calculando…"
                  : `${money(totals.totalIncome)} em receitas previstas − ${money(totals.totalExpense)} em gastos previstos`}
              </p>
              {!loading && totals.projected < 0 ? (
                <p className="forecast-warning" role="alert">
                  <TriangleAlert size={19} aria-hidden="true" />
                  <span>
                    {totals.totalIncome
                      ? `Com as receitas previstas, ainda faltarão ${money(-totals.projected)} para cobrir os gastos deste mês.`
                      : `Nenhuma renda foi informada. Com os gastos registrados, faltam ${money(-totals.projected)} em entradas para cobrir este mês. Informar sua renda continua sendo opcional.`}
                  </span>
                </p>
              ) : !loading ? (
                <p className="forecast-note">
                  {totals.totalExpense || totals.totalIncome
                    ? "Previsão após receber as entradas e pagar as contas lançadas, incluindo as parcelas deste mês."
                    : "Adicione entradas e gastos para acompanhar a previsão."}
                </p>
              ) : null}
            </section>
            {!loading &&
              !error &&
              month === day.slice(0, 7) &&
              totals.totalIncome > 0 && (
                <RadarPanel
                  today={day}
                  entries={rows}
                  totals={totals}
                  context={radar}
                  plan={plan}
                />
              )}
            <div className="overview-shortcuts">
              <a className="savings-shortcut" href="/caixinhas">
                <PiggyBank size={19} aria-hidden="true" />
                <span>Ver caixinhas</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
              <a className="savings-shortcut" href="/plano-do-mes">
                <SlidersHorizontal size={19} aria-hidden="true" />
                <span>
                  {planSuggestion
                    ? `Plano sugerido · ${planSuggestion.profile.name}`
                    : "Plano do mês"}
                </span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
            <DuePanel
              entries={due}
              today={day}
              onConfirm={confirmPayment}
              onEdit={editDue}
              busyId={busy ? editing?.id || null : null}
            />
            {entryActions}
            <section className="insights">
              <article className="panel categories">
                <div className="panel-title">
                  <h2>Para onde foi o dinheiro?</h2>
                  <span>Gastos pagos por categoria</span>
                </div>
                {groups.length ? (
                  <div className="category-content">
                    <div
                      className="donut"
                      style={{
                        background: `conic-gradient(${groups
                          .map((g, i) => {
                            const start =
                              (groups
                                .slice(0, i)
                                .reduce((a, c) => a + c.value, 0) /
                                expense) *
                              100;
                            return `${g.color} ${start}% ${start + (g.value / expense) * 100}%`;
                          })
                          .join(",")})`,
                      }}
                    >
                      <div>
                        <small>Total de gastos</small>
                        <b>{money(expense)}</b>
                      </div>
                    </div>
                    <div className="legend">
                      {groups.map((g) => (
                        <div key={g.name}>
                          <span>
                            <i style={{ background: g.color }} />
                            {g.name}
                          </span>
                          <b>
                            {money(g.value)}{" "}
                            <small>
                              {Math.round((g.value / expense) * 100)}%
                            </small>
                          </b>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="empty-chart">
                    <div className="donut blank">
                      <div>
                        <small>Total de gastos</small>
                        <b>R$ 0,00</b>
                      </div>
                    </div>
                    <p>
                      Seu primeiro gasto vai dar
                      <br />
                      forma a este resumo.
                    </p>
                  </div>
                )}
              </article>
              <article className="panel together">
                <span className="tag">OLHAR DO MÊS</span>
                <h2>
                  {groups.length
                    ? "Os números contam uma história."
                    : "Começa com um registro."}
                </h2>
                <p>
                  {groups.length
                    ? `${groups[0].name} é a maior categoria de gastos: ${money(groups[0].value)} neste mês.`
                    : "Anotem o que entra e o que sai, mesmo os pequenos valores. Logo fica mais fácil entender os hábitos da casa."}
                </p>
                {paidBy.length > 0 && (
                  <div className="payer-summary">
                    <h3>Quem pagou neste mês</h3>
                    {paidBy.map(([key, { label: payer, total }]) => (
                      <div key={key}>
                        <span>{payer}</span>
                        <b>{money(total)}</b>
                      </div>
                    ))}
                  </div>
                )}
                <div className="tip">
                  <Leaf size={22} />
                  <span>
                    {income > expense && income
                      ? "Vocês gastaram menos do que receberam neste mês."
                      : income && expense > income
                        ? "Os gastos registrados superam as entradas. Confiram se falta registrar alguma receita."
                        : "Não precisa ser perfeito. Precisa fazer parte da rotina."}
                  </span>
                </div>
              </article>
            </section>
            <UpcomingPanel
              entries={upcoming}
              today={day}
              loading={loading}
              error={upcomingError}
            />
            <a className="savings-shortcut" href="/relatorio-anual">
              <CalendarRange size={19} aria-hidden="true" /> Ver relatórios
            </a>
            <div className="footnote">
              Nossa Conta <span>•</span> Um passo de cada vez, juntos.
            </div>
          </>
        )}
      </main>
      {modal && (
        <div className="overlay" onClick={() => !busy && setModal("")}>
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={modal === "share" ? "Compartilhar" : "Novo lançamento"}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Fechar"
              onClick={() => setModal("")}
            >
              <X />
            </button>
            {modal === "share" ? (
              <SharePanel />
            ) : (
              <>
                <span className="tag">NOVO LANÇAMENTO</span>
                <h2>
                  {paymentMode
                    ? modal === "income"
                      ? "Confirmar recebimento"
                      : "Confirmar pagamento"
                    : editing
                      ? "Editar lançamento"
                      : modal === "income"
                        ? "Adicionar entrada"
                        : "Adicionar gasto"}
                </h2>
                <p>
                  {modal === "income"
                    ? "O que entrou para a casa?"
                    : "Anote agora, entenda melhor depois."}
                </p>
                <form onSubmit={save}>
                  {editing?.installment_count && (
                    <div className="installment-summary">
                      Parcela {editing.installment_number} de{" "}
                      {editing.installment_count}. As alterações afetam somente
                      esta parcela.
                    </div>
                  )}
                  {modal === "expense" && !editing && (
                    <label>
                      Tipo de gasto
                      <select
                        value={expenseMode}
                        onChange={(e) => setExpenseMode(e.target.value)}
                      >
                        <option value="single">Gasto único</option>
                        <option value="recurring">Recorrente todo mês</option>
                        <option value="installment">Gasto parcelado</option>
                      </select>
                    </label>
                  )}
                  {isInstallment && (
                    <div className="formgrid">
                      <label>
                        Como informar o valor?
                        <select
                          value={installmentMode}
                          onChange={(e) =>
                            setInstallmentMode(
                              e.target.value as InstallmentMode,
                            )
                          }
                        >
                          <option value="total">Valor total da compra</option>
                          <option value="per_installment">
                            Valor de cada parcela
                          </option>
                        </select>
                      </label>
                      <label>
                        Quantidade de parcelas
                        <input
                          type="number"
                          inputMode="numeric"
                          min={2}
                          max={120}
                          step={1}
                          required
                          value={installmentCount || ""}
                          onChange={(e) =>
                            setInstallmentCount(Number(e.target.value))
                          }
                        />
                      </label>
                    </div>
                  )}
                  <label>
                    Descrição
                    <input
                      autoFocus
                      defaultValue={editing?.description}
                      name="description"
                      required
                      maxLength={120}
                      placeholder={
                        modal === "income"
                          ? "Ex.: Salário de novembro"
                          : "Ex.: Compras do mercado"
                      }
                    />
                  </label>
                  <div className="formgrid">
                    <label>
                      {isInstallment
                        ? installmentMode === "total"
                          ? "Valor total da compra (R$)"
                          : "Valor de cada parcela (R$)"
                        : "Valor (R$)"}
                      <MoneyInput
                        key={editing?.id || modal}
                        defaultCents={editing?.amount}
                        onValueChange={setInputAmount}
                      />
                      <small id="money-help" className="field-hint">
                        Digite só os números; os centavos são automáticos.
                      </small>
                    </label>
                    <label>
                      {isInstallment
                        ? "Vencimento da primeira parcela"
                        : modal === "expense"
                          ? "Vencimento"
                          : paymentConfirmed
                            ? "Data do recebimento"
                            : "Data prevista do recebimento"}
                      <input
                        name="date"
                        required
                        type="date"
                        defaultValue={
                          editing?.date ||
                          (month === today().slice(0, 7)
                            ? today()
                            : month + "-01")
                        }
                      />
                    </label>
                  </div>
                  {isInstallment && (
                    <div className="installment-summary" role="status">
                      {installmentPreview ? (
                        <>
                          <strong>
                            Total: {money(installmentPreview.total)}
                          </strong>
                          <p>
                            {installmentCount} parcelas de{" "}
                            {money(installmentPreview.amounts[0])}
                            {installmentPreview.amounts[0] !==
                            installmentPreview.amounts[installmentCount - 1]
                              ? ` a ${money(installmentPreview.amounts[installmentCount - 1])}, com ajuste de centavos para fechar o total`
                              : ""}
                            .
                          </p>
                        </>
                      ) : (
                        <p>Informe um valor válido e de 2 a 120 parcelas.</p>
                      )}
                      <small>
                        Uma parcela por mês a partir do vencimento acima. Cada
                        pagamento será confirmado separadamente. Em meses mais
                        curtos, o vencimento será no último dia.
                      </small>
                    </div>
                  )}
                  <CategoryPicker
                    onPendingChange={setCategoryPending}
                    key={editing?.id || modal}
                    kind={modal}
                    initial={editing?.category}
                    defaults={
                      modal === "income" ? incomeCategories : expenseCategories
                    }
                    onRename={() => {
                      void reload();
                    }}
                  />
                  <label>
                    {modal === "income"
                      ? "De quem é esta entrada?"
                      : "Responsável pela conta"}
                    <input
                      name="person"
                      list="people"
                      required
                      defaultValue={editing?.person || name}
                      maxLength={60}
                      placeholder="Nome da pessoa"
                    />
                    <datalist id="people">
                      {people.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </datalist>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="paymentStatus"
                      value="confirmed"
                      checked={paymentConfirmed}
                      onChange={(event) =>
                        setPaymentConfirmed(event.target.checked)
                      }
                      aria-describedby="payment-status-help"
                    />
                    {modal === "income"
                      ? "Confirmar recebimento agora"
                      : isInstallment
                        ? "Confirmar pagamento da primeira parcela agora"
                        : "Confirmar pagamento agora"}
                  </label>
                  <p id="payment-status-help" className="field-hint">
                    {modal === "income"
                      ? "Deixe desmarcado para lançar como a receber."
                      : isInstallment
                        ? "As demais parcelas ficam a pagar."
                        : "Deixe desmarcado para lançar como a pagar."}
                  </p>
                  {modal === "expense" && paymentConfirmed && (
                    <label>
                      Quem pagou?
                      <input
                        name="payer"
                        list="people"
                        required
                        maxLength={60}
                        defaultValue={editing?.payer || name}
                        placeholder="Nome de quem fez o pagamento"
                      />
                      <small className="field-hint">
                        Pode ser outra pessoa, mesmo que a conta tenha sido
                        cadastrada por você.
                      </small>
                    </label>
                  )}
                  {modal === "expense" &&
                    !editing &&
                    expenseMode === "recurring" && (
                      <p className="field-hint">
                        Esta conta será repetida todo mês. O valor poderá ser
                        ajustado por mês; os próximos ficam a pagar até a
                        confirmação.
                      </p>
                    )}
                  {editing?.id.includes(":") && (
                    <>
                      <label className="check">
                        <input type="checkbox" name="future" /> Usar este valor
                        como padrão nos próximos meses
                        <small>Meses já registrados não serão alterados.</small>
                      </label>
                      <button
                        type="button"
                        className="text-button"
                        onClick={async () => {
                          if (
                            !confirm(
                              "Encerrar a recorrência após este mês? Os lançamentos já registrados serão mantidos.",
                            )
                          )
                            return;
                          try {
                            const r = await fetch("/api/entries", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                id: editing.id,
                                action: "stop",
                              }),
                            });
                            if (!r.ok) throw Error();
                            setModal("");
                            await reload();
                          } catch {
                            setError(
                              "Não foi possível encerrar a recorrência.",
                            );
                          }
                        }}
                      >
                        Encerrar recorrência após este mês
                      </button>
                    </>
                  )}
                  {error && <p className="error">{error}</p>}
                  <button
                    className="primary save"
                    disabled={busy || categoryPending}
                  >
                    {busy
                      ? "Salvando..."
                      : paymentMode && paymentConfirmed
                        ? modal === "income"
                          ? "Confirmar recebimento"
                          : "Confirmar pagamento"
                        : "Salvar lançamento"}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
