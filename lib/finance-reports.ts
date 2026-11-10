import type { PaymentMethod } from "./payment-methods";

export function upcomingEnd(day: string) {
  const end = new Date(day + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10);
}

function monthEnd(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

export function annualPeriods(year: number, today: string) {
  // Confirmed expenses may have a due date later in the current month.
  // Use the same complete months as the dashboard and monthly report.
  const month = year === Number(today.slice(0, 4)) ? today.slice(5, 7) : "12";
  return {
    current: { start: `${year}-01-01`, end: monthEnd(`${year}-${month}`) },
    previous: {
      start: `${year - 1}-01-01`,
      end: monthEnd(`${year - 1}-${month}`),
    },
  };
}

export type AnnualReport = {
  periods: ReturnType<typeof annualPeriods>;
  total: number;
  previousTotal: number;
  months?: { month: string; total: number }[];
  categories: { name: string; current: number; previous: number }[];
  paymentMethods?: { method: PaymentMethod | null; total: number }[];
};

export function annualTotals(
  current: Map<string, number>,
  previous: Map<string, number>,
) {
  const categories = [...new Set([...current.keys(), ...previous.keys()])]
    .map((name) => ({
      name,
      current: current.get(name) ?? 0,
      previous: previous.get(name) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.current - a.current ||
        b.previous - a.previous ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
  return {
    categories,
    total: categories.reduce((sum, category) => sum + category.current, 0),
    previousTotal: categories.reduce(
      (sum, category) => sum + category.previous,
      0,
    ),
  };
}

export function monthlyPeriods(month: string): AnnualReport["periods"] {
  const [year, number] = month.split("-").map(Number);
  const previous = new Date(Date.UTC(year, number - 2, 1))
    .toISOString()
    .slice(0, 7);
  return {
    current: {
      start: month + "-01",
      end: monthEnd(month),
    },
    previous: {
      start: previous + "-01",
      end: monthEnd(previous),
    },
  };
}
