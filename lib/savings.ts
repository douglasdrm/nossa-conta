export type SavingsMovement = {
  id: string;
  amount: number;
  kind: "deposit" | "withdraw";
  status: "planned" | "saved";
  date: string;
  actor: string;
};

export type SavingsGoal = {
  id: string;
  name: string;
  target: number;
  deadline: string;
  priority: number;
  saved: number;
  savedBeforeMonth: number;
  savedInMonth: number;
  planned: number;
  movements: SavingsMovement[];
};

export type SavingsOverview = { buffer: number; goals: SavingsGoal[] };

export const savingsPriorities = [
  { value: 1, label: "Alta" },
  { value: 2, label: "Média" },
  { value: 3, label: "Baixa" },
] as const;

export function savingsPriority(value: number) {
  return value === 1
    ? savingsPriorities[0]
    : value === 2
      ? savingsPriorities[1]
      : savingsPriorities[2];
}

export function savingsPlan(
  overview: SavingsOverview,
  income: number,
  expenses: number,
  today: string,
) {
  const month = today.slice(0, 7);
  const monthNumber = (value: string) =>
    Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
  const reserved = Math.max(
    0,
    overview.goals.reduce((sum, goal) => sum + goal.savedInMonth, 0),
  );
  const planned = overview.goals.reduce((sum, goal) => sum + goal.planned, 0);
  const free = income - expenses - reserved;
  let available = Math.max(0, free - overview.buffer - planned);
  const orderedGoals = [...overview.goals].sort(
    (a, b) =>
      savingsPriority(a.priority).value - savingsPriority(b.priority).value ||
      a.deadline.localeCompare(b.deadline),
  );
  const goals = orderedGoals.map((goal) => {
    const missing = Math.max(0, goal.target - goal.saved);
    const expired = goal.deadline < today && missing > 0;
    const months = Math.max(
      1,
      monthNumber(goal.deadline) - monthNumber(month) + 1,
    );
    const monthlyTarget =
      expired || !missing
        ? 0
        : Math.ceil(Math.max(0, goal.target - goal.savedBeforeMonth) / months);
    const monthlyRemaining = Math.min(
      missing,
      Math.max(0, monthlyTarget - goal.savedInMonth),
    );
    const suggested =
      income && !expired
        ? Math.min(available, Math.max(0, monthlyRemaining - goal.planned))
        : 0;
    available -= suggested;
    return {
      ...goal,
      missing,
      expired,
      monthlyTarget,
      monthlyRemaining,
      suggested,
    };
  });
  return { reserved, planned, free, goals };
}
