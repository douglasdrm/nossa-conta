"use client";
import { useEffect, useState, useRef } from "react";
import SharePanel from "@/components/share-panel";
import MoneyInput from "@/components/money-input";
import DuePanel from "@/components/due-panel";
import {
  dateInSaoPaulo,
  moneyInputToCents,
  financeTotals,
  paymentState,
} from "@/lib/finance";
import {
  Wallet,
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
  confirmed_at: string | null;
};
const cats = [
  "Mercado",
  "Moradia",
  "Alimentação",
  "Transporte",
  "Saúde",
  "Lazer",
  "Compras",
  "Educação",
  "Contas e serviços",
  "Outros",
];
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
export default function Dashboard({ name }: { name: string }) {
  const [editing, setEditing] = useState<Entry | null>(null);
  const [paymentMode, setPaymentMode] = useState(false),
    [paymentStatus, setPaymentStatus] = useState("pending");
  const [data, setData] = useState<Entry[]>([]),
    [month, setMonth] = useState(today().slice(0, 7)),
    [modal, setModal] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all"),
    [person, setPerson] = useState("Todos"),
    [query, setQuery] = useState("");
  const [due, setDue] = useState<Entry[]>([]),
    [day, setDay] = useState(today());
  const requestId = useRef(0);
  useEffect(() => {
    setPaymentStatus(
      modal === "income" || paymentMode || editing?.confirmed
        ? "confirmed"
        : "pending",
    );
  }, [modal, editing?.id, paymentMode]);
  useEffect(() => {
    const timer = setInterval(() => setDay(today()), 30000);
    return () => clearInterval(timer);
  }, []);
  async function reload(target = month) {
    const seq = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const months = [...new Set([target, today().slice(0, 7)])];
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
      const [r, alerts] = await Promise.all([
        fetch("/api/entries?month=" + encodeURIComponent(target)),
        fetch("/api/entries?due=true"),
      ]);
      if (!r.ok || !alerts.ok) throw Error();
      const [records, reminders] = await Promise.all([r.json(), alerts.json()]);
      if (seq === requestId.current) {
        setData(records);
        setDue(reminders);
      }
    } catch {
      if (seq === requestId.current)
        setError(
          "Não foi possível carregar os registros. Tente atualizar a página.",
        );
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
    totals = financeTotals(rows),
    income = totals.income,
    expense = totals.paid,
    pending = totals.pending,
    groups = cats
      .map((c, i) => ({
        name: c,
        color: colors[i],
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
          .flatMap((e) => [e.person, e.payer])
          .filter((p): p is string => Boolean(p)),
      ]),
    ];
  const paidBy = Object.entries(
    rows
      .filter((e) => e.kind === "expense" && e.confirmed)
      .reduce(
        (r, e) => {
          const p = e.payer || "Não informado";
          r[p] = (r[p] || 0) + e.amount;
          return r;
        },
        {} as Record<string, number>,
      ),
  ).sort((a, b) => b[1] - a[1]);
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
          confirmed:
            modal === "income" || f.get("paymentStatus") === "confirmed",
          payer:
            modal === "expense" && f.get("paymentStatus") === "confirmed"
              ? String(f.get("payer") || name).trim()
              : undefined,
          id: editing?.id,
          repeats: f.get("repeats") === "on",
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
    setPaymentStatus("confirmed");
    setModal("expense");
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
        "Excluir este lançamento? Em uma conta recorrente, apenas este mês será excluído.",
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
            e.description,
            e.kind === "income" ? "Entrada" : "Saída",
            e.category,
            e.person,
            (e.amount / 100).toFixed(2).replace(".", ","),
            e.kind === "income"
              ? "Recebido"
              : e.confirmed
                ? "Pago"
                : "Pendente",
            e.kind === "expense" && e.confirmed
              ? e.payer || "Não informado"
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
        <a className="nav active" href="#">
          <LayoutDashboard size={19} /> Visão geral
        </a>
        <a className="nav" href="#records">
          <ArrowUpRight size={19} /> Lançamentos
        </a>
        <button className="nav" onClick={() => setModal("share")}>
          <Users size={19} /> Compartilhar
        </button>
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
          <span>{name[0]}</span>
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
          <div className="breadcrumb">
            Nosso espaço <span>/</span> Visão geral
          </div>
          <button className="share" onClick={() => setModal("share")}>
            <Users size={16} /> Espaço compartilhado
          </button>
        </header>
        <section className="heading">
          <div>
            <p className="eyebrow">CADA ESCOLHA CONTA</p>
            <h1>O dinheiro da casa, às claras.</h1>
            <p>Mais organização hoje. Mais planos juntos amanhã.</p>
          </div>
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
        </section>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <section className="stats">
          <article className="balance">
            <div>
              Saldo do mês <Wallet size={20} />
            </div>
            <strong>{income ? money(income - expense) : "—"}</strong>
            <small>
              {income
                ? "Entradas menos os gastos pagos"
                : "Renda opcional. Informe se quiser calcular o saldo."}
            </small>
            <div className="balance-line" />
          </article>
          <article>
            <div>
              Entrou{" "}
              <span className="icon income">
                <ArrowDownLeft size={18} />
              </span>
            </div>
            <strong className={!income ? "no-income" : ""}>
              {income ? money(income) : "Não informada"}
            </strong>
            <small>Opcional · salários e outras receitas</small>
          </article>
          <article>
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
        <DuePanel
          entries={due}
          today={day}
          onConfirm={confirmPayment}
          onEdit={editDue}
          busyId={busy ? editing?.id || null : null}
        />
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
                          (groups.slice(0, i).reduce((a, c) => a + c.value, 0) /
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
                        <small>{Math.round((g.value / expense) * 100)}%</small>
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
                {paidBy.map(([payer, total]) => (
                  <div key={payer}>
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
        <section id="records" className="panel records">
          <div className="panel-title">
            <div>
              <h2>Lançamentos do mês</h2>
              <span>Tudo em um lugar, sem perder os detalhes.</span>
            </div>
            <button
              className="export"
              disabled={!rows.length}
              onClick={exportCsv}
            >
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
                  <th>Responsável</th>
                  <th>Pago por</th>
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
                      {e.id.includes(":") && (
                        <span
                          title="Despesa recorrente"
                          className="recurring-mark"
                        >
                          <Repeat2 size={12} />
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="pill">{e.category}</span>
                    </td>
                    <td>{e.person}</td>
                    <td>
                      {e.kind === "expense" && e.confirmed
                        ? e.payer || "Não informado"
                        : "—"}
                    </td>
                    <td>{e.date.split("-").reverse().join("/")}</td>
                    <td>
                      <span className={"status-pill " + paymentState(e, day)}>
                        {
                          {
                            received: "Recebido",
                            paid: "Pago",
                            pending: "Pendente",
                            due: "Vence hoje",
                            overdue: "Vencido",
                          }[paymentState(e, day)]
                        }
                      </span>
                      {e.kind === "expense" && !e.confirmed && (
                        <button
                          className="confirm-inline"
                          disabled={busy}
                          onClick={() => confirmPayment(e.id)}
                        >
                          Confirmar pagamento
                        </button>
                      )}
                    </td>
                    <td className={`amount ${e.kind}`}>
                      {e.kind === "income" ? "+" : "−"} {money(e.amount)}
                    </td>
                    <td>
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
        <div className="footnote">
          Nossa Conta <span>•</span> Um passo de cada vez, juntos.
        </div>
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
                    ? "Confirmar pagamento"
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
                      Valor (R$)
                      <MoneyInput
                        key={editing?.id || modal}
                        defaultCents={editing?.amount}
                      />
                      <small id="money-help" className="field-hint">
                        Digite só os números; os centavos são automáticos.
                      </small>
                    </label>
                    <label>
                      {modal === "expense" ? "Vencimento" : "Data"}
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
                  <label>
                    Categoria
                    <select name="category" defaultValue={editing?.category}>
                      {(modal === "income"
                        ? [
                            "Salário",
                            "Freelance",
                            "Rendimentos",
                            "Outras receitas",
                          ]
                        : cats
                      ).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
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
                  {modal === "expense" && (
                    <label>
                      Pagamento
                      <select
                        name="paymentStatus"
                        value={paymentStatus}
                        onChange={(e) => setPaymentStatus(e.target.value)}
                      >
                        <option value="pending">Ainda vou pagar</option>
                        <option value="confirmed">Já paguei</option>
                      </select>
                      <small className="field-hint">
                        Pendente não sai do saldo. Confirme depois que pagar.
                      </small>
                    </label>
                  )}
                  {modal === "expense" && paymentStatus === "confirmed" && (
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
                  {modal === "expense" && !editing && (
                    <label className="check">
                      <input type="checkbox" name="repeats" /> Repetir esta
                      despesa todo mês
                      <small>
                        O valor poderá ser ajustado em cada mês. Os próximos
                        meses ficam pendentes até a confirmação.
                      </small>
                    </label>
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
                  <button className="primary save" disabled={busy}>
                    {busy
                      ? "Salvando..."
                      : paymentMode && paymentStatus === "confirmed"
                        ? "Confirmar pagamento"
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
