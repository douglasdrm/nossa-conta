import { test } from "node:test";
import assert from "node:assert/strict";
import { savingsPlan, type SavingsGoal } from "../lib/savings";

const goal: SavingsGoal = {
  id: "viagem",
  name: "Viagem",
  target: 240000,
  deadline: "2027-04-30",
  priority: 1,
  saved: 0,
  savedBeforeMonth: 0,
  savedInMonth: 0,
  planned: 0,
  movements: [],
};

test("monthly target recalculates from savings made before the selected month", () => {
  const first = savingsPlan(
    { buffer: 0, goals: [goal] },
    400000,
    300000,
    "2026-11-09",
  );
  assert.equal(first.goals[0].monthlyTarget, 40000);
  const next = savingsPlan(
    { buffer: 0, goals: [{ ...goal, saved: 30000, savedBeforeMonth: 30000 }] },
    400000,
    300000,
    "2026-12-01",
  );
  assert.equal(next.goals[0].monthlyTarget, 42000);
});

test("suggestions share one surplus after paid and unpaid expenses, reservations, plans and buffer", () => {
  const other = { ...goal, id: "reserva", priority: 2 };
  const plan = savingsPlan(
    {
      buffer: 10000,
      goals: [
        { ...goal, saved: 10000, savedInMonth: 10000, planned: 5000 },
        other,
      ],
    },
    365000,
    300000,
    "2026-11-09",
  );
  assert.equal(plan.free, 55000);
  assert.equal(plan.planned, 5000);
  assert.deepEqual(
    plan.goals.map((item) => item.suggested),
    [25000, 15000],
  );
  assert.equal(
    savingsPlan({ buffer: 0, goals: [goal] }, 0, 0, "2026-11-09").goals[0]
      .suggested,
    0,
  );
  assert.equal(
    savingsPlan({ buffer: 0, goals: [goal] }, 500000, 0, "2027-05-01").goals[0]
      .suggested,
    0,
  );
});
