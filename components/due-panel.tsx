"use client";
import { useEffect, useState } from "react";
import { Bell, Check, Clock, AlertCircle, Pencil } from "lucide-react";
export type DueEntry = {
  id: string;
  description: string;
  amount: number;
  date: string;
  person: string;
};
const money = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    n / 100,
  );
export default function DuePanel({
  entries,
  today,
  onConfirm,
  onEdit,
  busyId,
}: {
  entries: DueEntry[];
  today: string;
  onConfirm: (id: string) => void;
  onEdit: (id: string) => void;
  busyId: string | null;
}) {
  const [all, setAll] = useState(false),
    [enabled, setEnabled] = useState(false),
    [note, setNote] = useState("");
  useEffect(() => {
    try {
      setEnabled(localStorage.getItem("nc-due-notifications") === "true");
    } catch {}
  }, []);
  useEffect(() => {
    if (
      !enabled ||
      !entries.length ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    )
      return;
    try {
      const key = "nc-due-notified:" + today;
      const seen: string[] = JSON.parse(localStorage.getItem(key) || "[]");
      const fresh = entries.filter((e) => !seen.includes(e.id));
      if (!fresh.length) return;
      const notification = new Notification("Nossa Conta: contas a confirmar", {
        body: "Há despesas vencidas ou vencendo hoje. Abra o aplicativo para conferir.",
        tag: "nc-due-" + today,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      localStorage.setItem(
        key,
        JSON.stringify([...new Set([...seen, ...fresh.map((e) => e.id)])]),
      );
    } catch {
      setNote(
        "Este navegador não permitiu a notificação. Os avisos continuam aparecendo aqui.",
      );
    }
  }, [enabled, entries, today]);
  const overdue = entries.filter((e) => e.date < today).length;
  return (
    <>
      <div className="reminder-settings">
        <span>
          <Bell size={14} /> Avisos de vencimento aparecem aqui no app.
        </span>
        <button
          className="text-button"
          onClick={async () => {
            if (enabled) {
              setEnabled(false);
              localStorage.setItem("nc-due-notifications", "false");
              setNote("Notificações deste navegador desativadas.");
              return;
            }
            if (!("Notification" in window)) {
              setNote(
                "Este navegador não oferece notificações. Os avisos continuam no app.",
              );
              return;
            }
            try {
              const permission = await Notification.requestPermission();
              if (permission === "granted") {
                setEnabled(true);
                localStorage.setItem("nc-due-notifications", "true");
                setNote(
                  "Ativado neste navegador, enquanto o app estiver aberto.",
                );
              } else
                setNote(
                  "Permissão não concedida. Os avisos continuam aparecendo aqui.",
                );
            } catch {
              setNote("Não foi possível ativar neste navegador.");
            }
          }}
        >
          {enabled
            ? "Desativar notificações"
            : "Ativar notificações neste navegador"}
        </button>
      </div>
      {note && (
        <p role="status" className="notification-note">
          {note}
        </p>
      )}
      {entries.length > 0 && (
        <section className="due-panel" aria-label="Contas a confirmar">
          <div className="due-heading">
            <div>
              <span className="tag">LEMBRETE DA CASA</span>
              <h2>
                <Bell size={19} /> {entries.length} conta
                {entries.length !== 1 ? "s" : ""} para conferir
              </h2>
              <p>
                {overdue > 0
                  ? `${overdue} vencida${overdue !== 1 ? "s" : ""} · `
                  : ""}
                {entries.length - overdue} vencendo hoje. O pagamento só entra
                no saldo depois da sua confirmação.
              </p>
            </div>
            <span className="due-total">
              {money(entries.reduce((s, e) => s + e.amount, 0))}
            </span>
          </div>
          <div>
            {(all ? entries : entries.slice(0, 3)).map((e) => (
              <div className="due-item" key={e.id}>
                <span className="due-symbol">
                  {e.date < today ? (
                    <AlertCircle size={18} />
                  ) : (
                    <Clock size={18} />
                  )}
                </span>
                <div className="due-details">
                  <b>{e.description}</b>
                  <small>
                    {e.date < today
                      ? "Venceu em " + e.date.split("-").reverse().join("/")
                      : "Vence hoje"}{" "}
                    · {e.person}
                  </small>
                </div>
                <b className="due-amount">{money(e.amount)}</b>
                <div className="due-actions">
                  <button
                    title="Editar antes de confirmar"
                    aria-label={"Editar " + e.description}
                    className="secondary"
                    onClick={() => onEdit(e.id)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="primary"
                    disabled={busyId !== null}
                    onClick={() => onConfirm(e.id)}
                  >
                    <Check size={15} />
                    {busyId === e.id ? "Confirmando..." : "Confirmar pagamento"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {entries.length > 3 && (
            <button className="text-button" onClick={() => setAll(!all)}>
              {all ? "Mostrar menos" : `Ver todas as ${entries.length} contas`}
            </button>
          )}
        </section>
      )}
    </>
  );
}
