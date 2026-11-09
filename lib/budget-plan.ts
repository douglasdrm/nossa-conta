export const budgetGroups = {
  essentials: "Essenciais",
  future: "Futuro",
  leisure: "Lazer e gastos livres",
  development: "Desenvolvimento pessoal",
} as const;
export type BudgetGroup = keyof typeof budgetGroups;
export const budgetKeys = Object.keys(budgetGroups) as BudgetGroup[];
export type BudgetShares = Record<BudgetGroup, number>;

export const budgetProfiles = [
  {
    id: "house",
    name: "Casa em Dia",
    goal: "Organizar as contas",
    shares: { essentials: 70, future: 15, leisure: 10, development: 5 },
  },
  {
    id: "balance",
    name: "Equilíbrio",
    goal: "Equilibrar o mês",
    shares: { essentials: 60, future: 20, leisure: 10, development: 10 },
  },
  {
    id: "goals",
    name: "Sonhos à Frente",
    goal: "Juntar para uma meta",
    shares: { essentials: 55, future: 30, leisure: 10, development: 5 },
  },
] as const;

export type BudgetPlan = {
  enabled: boolean;
  shares: BudgetShares;
  categories: Record<string, BudgetGroup>;
  categoryGroups?: Record<string, BudgetGroup>;
};

export const defaultPlan: BudgetPlan = {
  enabled: false,
  shares: budgetProfiles[0].shares,
  categories: {},
};

const defaults = new Map<string, BudgetGroup>([
  ["Mercado", "essentials"],
  ["Alimentação", "essentials"],
  ["Moradia", "essentials"],
  ["Transporte", "essentials"],
  ["Saúde", "essentials"],
  ["Contas e serviços", "essentials"],
  ["Lazer", "leisure"],
  ["Compras", "leisure"],
  ["Outros", "leisure"],
  ["Educação", "development"],
]);

export function budgetGroup(
  category: string,
  categories: BudgetPlan["categories"],
) {
  return Object.hasOwn(categories, category)
    ? categories[category]
    : defaults.get(category);
}

export function transferShare(
  shares: BudgetShares,
  group: BudgetGroup,
  other: BudgetGroup,
  value: number,
) {
  if (group === other) return shares;
  const next = Math.max(
    0,
    Math.min(shares[group] + shares[other], Math.round(value)),
  );
  return {
    ...shares,
    [group]: next,
    [other]: shares[other] + shares[group] - next,
  };
}

export function budgetAmounts(income: number, shares: BudgetShares) {
  let remaining = income;
  const ranked = budgetKeys.map((key) => {
    const scaled = income * shares[key];
    const amount = Math.floor(scaled / 100);
    remaining -= amount;
    return { key, amount, remainder: scaled % 100 };
  });
  ranked.sort((a, b) => b.remainder - a.remainder);
  return Object.fromEntries(
    ranked.map(({ key, amount }, index) => [
      key,
      amount + Number(index < remaining),
    ]),
  ) as BudgetShares;
}

export function budgetSpending(
  entries: { kind: string; category: string; amount: number }[],
  categories: BudgetPlan["categories"],
) {
  const groups: BudgetShares = {
    essentials: 0,
    future: 0,
    leisure: 0,
    development: 0,
  };
  let unassigned = 0;
  for (const entry of entries) {
    if (entry.kind !== "expense") continue;
    const group = budgetGroup(entry.category, categories);
    if (group) groups[group] += entry.amount;
    else unassigned += entry.amount;
  }
  return { groups, unassigned };
}

export function suggestedBudget(
  income: number,
  entries: Parameters<typeof budgetSpending>[0],
  plan: BudgetPlan,
) {
  if (plan.enabled || income <= 0) return null;
  const { groups, unassigned } = budgetSpending(entries, {
    ...plan.categoryGroups,
    ...plan.categories,
  });
  const expenses = budgetKeys.reduce(
    (sum, key) => sum + groups[key],
    unassigned,
  );
  if (expenses === 0 || unassigned > expenses / 5) return null;

  const available = income - expenses;
  const observed = {
    ...groups,
    future: groups.future + Math.max(0, available),
  };
  const score = ({ shares }: (typeof budgetProfiles)[number]) => {
    const target = budgetAmounts(income, shares);
    return budgetKeys.reduce((sum, key) => {
      const difference = observed[key] - target[key];
      return (
        sum +
        Math.abs(difference) +
        (key === "essentials" ? Math.max(0, difference) * 2 : 0)
      );
    }, 0);
  };
  const profile = budgetProfiles.reduce((best, candidate) =>
    score(candidate) < score(best) ? candidate : best,
  );
  return {
    profile,
    essentialsPercent: Math.round((groups.essentials * 100) / income),
    essentialsOver: Math.max(
      0,
      groups.essentials - budgetAmounts(income, profile.shares).essentials,
    ),
    available,
  };
}
