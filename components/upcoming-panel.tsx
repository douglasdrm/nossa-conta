import { CalendarRange } from "lucide-react";
import { upcomingEnd } from "@/lib/finance-reports";

type Commitment = {
  id: string;
  kind: string;
  description: string;
  date: string;
  amount: number;
};
const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const money = (amount: number) => currency.format(amount / 100);
const shortDate = (day: string) => day.slice(5).split("-").reverse().join("/");

export default function UpcomingPanel({
  entries,
  today,
  loading,
  error,
}: {
  entries: Commitment[];
  today: string;
  loading: boolean;
  error: boolean;
}) {
  const expenses = entries.reduce(
    (total, entry) => total + (entry.kind === "expense" ? entry.amount : 0),
    0,
  );
  const income = entries.reduce(
    (total, entry) => total + (entry.kind === "income" ? entry.amount : 0),
    0,
  );
  const visibleCount = 6;
  return (
    <section
      id="records"
      className="panel upcoming-panel"
      aria-labelledby="upcoming-heading"
    >
      <div className="panel-title">
        <div>
          <h2 id="upcoming-heading">
            <CalendarRange size={19} aria-hidden="true" /> Próximos 7 dias
          </h2>
          <span>
            {shortDate(today)} a {shortDate(upcomingEnd(today))}
          </span>
        </div>
        <a href="/lancamentos" className="text-button">
          Ver lançamentos
        </a>
      </div>
      {loading ? (
        <p role="status">Carregando próximos compromissos…</p>
      ) : error ? (
        <p>Atualize a página para carregar os próximos compromissos.</p>
      ) : (
        <>
          <div className="report-periods">
            <div>
              <span>A pagar</span>
              <strong>{money(expenses)}</strong>
            </div>
            <div>
              <span>A receber</span>
              <strong>{money(income)}</strong>
            </div>
          </div>
          {entries.length ? (
            <ul className="upcoming-list">
              {entries.slice(0, visibleCount).map((entry) => (
                <li key={entry.id}>
                  <time dateTime={entry.date}>{shortDate(entry.date)}</time>
                  <strong>{entry.description}</strong>
                  <span>
                    {money(entry.amount)}{" "}
                    <small>
                      {entry.kind === "income" ? "a receber" : "a pagar"}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Nenhum lançamento pendente nos próximos sete dias.</p>
          )}
          {entries.length > visibleCount && (
            <p>
              Mais {entries.length - visibleCount} no período.{" "}
              <a href="/lancamentos">Ver lançamentos</a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
