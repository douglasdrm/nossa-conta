export type FinanceEntry = {
  kind: string;
  amount: number;
  date: string;
  confirmed: boolean;
};
const brNumber = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function moneyInputFromCents(cents: number) {
  return brNumber.format(cents / 100);
}
export function moneyInputToCents(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}
export function maskMoneyInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  return digits ? moneyInputFromCents(Number(digits)) : "";
}
export function dateInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const p = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${p("year")}-${p("month")}-${p("day")}`;
}
export function paymentState(entry: FinanceEntry, today = dateInSaoPaulo()) {
  if (entry.kind === "income") return "received";
  if (entry.confirmed) return "paid";
  return entry.date < today
    ? "overdue"
    : entry.date === today
      ? "due"
      : "pending";
}
export function financeTotals(entries: FinanceEntry[]) {
  return entries.reduce(
    (t, e) => {
      if (e.kind === "income") t.income += e.amount;
      else if (e.confirmed) t.paid += e.amount;
      else t.pending += e.amount;
      return t;
    },
    { income: 0, paid: 0, pending: 0 },
  );
}
