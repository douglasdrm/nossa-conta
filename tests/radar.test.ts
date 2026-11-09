import assert from "node:assert/strict";
import { test } from "node:test";
import {
  historyMonths,
  largestUnplannedExpense,
  radarPatterns,
} from "../lib/radar";

test("uses the median for categories present in all three comparable periods", () => {
  const today = "2026-01-15";
  assert.deepEqual(historyMonths(today), ["2025-10", "2025-11", "2025-12"]);
  assert.deepEqual(
    radarPatterns(today, [
      { date: "2025-10-15", category: "Mercado", amount: 45000 },
      { date: "2025-11-16", category: "Mercado", amount: 50000 },
      { date: "2025-12-20", category: "Mercado", amount: 110000 },
      { date: "2025-10-14", category: "Mercado", amount: 99999 },
      { date: "2025-12-20", category: "Lazer", amount: 70000 },
      { date: "2026-01-15", category: "Mercado", amount: 99999 },
    ]),
    [{ category: "Mercado", typical: 50000 }],
  );
});

test("subtracts expenses already covered by the month forecast", () => {
  const patterns = [{ category: "Mercado", typical: 50000 }];
  const entries = [
    {
      date: "2026-01-12",
      category: "Mercado",
      amount: 13000,
      confirmed: false,
    },
    { date: "2026-01-15", category: "Mercado", amount: 12000, confirmed: true },
    { date: "2026-01-14", category: "Mercado", amount: 50000, confirmed: true },
  ];
  assert.deepEqual(largestUnplannedExpense("2026-01-15", patterns, entries), {
    category: "Mercado",
    typical: 50000,
    extra: 25000,
  });
  assert.equal(
    largestUnplannedExpense("2026-01-15", patterns, [
      ...entries,
      {
        date: "2026-01-20",
        category: "Mercado",
        amount: 25000,
        confirmed: false,
      },
    ]),
    undefined,
  );
});
