export function upcomingEnd(day: string) {
  const end = new Date(day + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10);
}

export function annualPeriods(year: number, today: string) {
  const end = year === Number(today.slice(0, 4)) ? today : `${year}-12-31`;
  const month = Number(end.slice(5, 7));
  const previousDay = Math.min(
    Number(end.slice(8, 10)),
    new Date(Date.UTC(year - 1, month, 0)).getUTCDate(),
  );
  return {
    current: { start: `${year}-01-01`, end },
    previous: {
      start: `${year - 1}-01-01`,
      end: `${year - 1}-${end.slice(5, 7)}-${String(previousDay).padStart(2, "0")}`,
    },
  };
}

export type AnnualReport = {
  periods: ReturnType<typeof annualPeriods>;
  total: number;
  previousTotal: number;
  months?: { month: string; total: number }[];
  categories: { name: string; current: number; previous: number }[];
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

export function monthlyPeriods(
  month: string,
  today: string,
): AnnualReport["periods"] {
  const [year, number] = month.split("-").map(Number);
  const previous = new Date(Date.UTC(year, number - 2, 1))
    .toISOString()
    .slice(0, 7);
  const previousLastDay = new Date(Date.UTC(year, number - 1, 0)).getUTCDate();
  const isCurrent = month === today.slice(0, 7);
  const previousDay = isCurrent
    ? Math.min(Number(today.slice(8, 10)), previousLastDay)
    : previousLastDay;
  return {
    current: {
      start: month + "-01",
      end: isCurrent
        ? today
        : new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10),
    },
    previous: {
      start: previous + "-01",
      end: `${previous}-${String(previousDay).padStart(2, "0")}`,
    },
  };
}
