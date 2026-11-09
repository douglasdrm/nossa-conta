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
  if (entry.kind === "income") return entry.confirmed ? "received" : "expected";
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
      if (e.kind === "income") {
        if (e.confirmed) t.income += e.amount;
      } else if (e.confirmed) t.paid += e.amount;
      else t.pending += e.amount;
      return t;
    },
    { income: 0, paid: 0, pending: 0 },
  );
}

export function monthForecast(entries: FinanceEntry[]) {
  const { income, paid, pending } = financeTotals(entries);
  const pendingIncome = entries.reduce(
    (sum, entry) =>
      sum + (entry.kind === "income" && !entry.confirmed ? entry.amount : 0),
    0,
  );
  return {
    income,
    pendingIncome,
    totalIncome: income + pendingIncome,
    paid,
    pending,
    totalExpense: paid + pending,
    current: income - paid,
    projected: income + pendingIncome - paid - pending,
  };
}

export type InstallmentMode = "total" | "per_installment";
export function installmentAmounts(
  amount: number,
  count: number,
  mode: InstallmentMode,
) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 1_000_000_000 ||
    !Number.isInteger(count) ||
    count < 2 ||
    count > 120 ||
    !["total", "per_installment"].includes(mode)
  )
    return null;
  const total = mode === "total" ? amount : amount * count;
  if (total > 1_000_000_000 || total < count) return null;
  const base = Math.floor(total / count),
    remainder = total % count;
  return {
    total,
    amounts: Array.from(
      { length: count },
      (_, i) => base + (i < remainder ? 1 : 0),
    ),
  };
}
export function installmentDate(first: string, index: number) {
  const [year, month, day] = first.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + index, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}
