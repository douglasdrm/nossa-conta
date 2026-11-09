export type RadarExpense = { date: string; category: string; amount: number };
export type RadarPattern = { category: string; typical: number };

export function historyMonths(today: string) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return [3, 2, 1].map((offset) =>
    new Date(Date.UTC(year, month - offset, 1)).toISOString().slice(0, 7),
  );
}

export function radarPatterns(today: string, expenses: RadarExpense[]) {
  const months = historyMonths(today);
  const spending = new Map<string, number[]>();
  for (const expense of expenses) {
    const index = months.indexOf(expense.date.slice(0, 7));
    if (index < 0 || expense.date.slice(8) < today.slice(8)) continue;
    const totals = spending.get(expense.category) ?? [0, 0, 0];
    totals[index] += expense.amount;
    spending.set(expense.category, totals);
  }
  return [...spending]
    .filter(([, totals]) => totals.every((total) => total > 0))
    .map(([category, totals]) => ({
      category,
      typical: totals.sort((a, b) => a - b)[1],
    }));
}

export function largestUnplannedExpense(
  today: string,
  patterns: RadarPattern[],
  expenses: (RadarExpense & { confirmed: boolean })[],
) {
  const booked = new Map<string, number>();
  for (const expense of expenses) {
    if (expense.confirmed && expense.date < today) continue;
    booked.set(
      expense.category,
      (booked.get(expense.category) ?? 0) + expense.amount,
    );
  }
  return patterns
    .map((pattern) => ({
      ...pattern,
      extra: pattern.typical - (booked.get(pattern.category) ?? 0),
    }))
    .filter(({ extra }) => extra > 0)
    .sort(
      (a, b) =>
        b.extra - a.extra || a.category.localeCompare(b.category, "pt-BR"),
    )[0];
}
