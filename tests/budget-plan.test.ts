import assert from "node:assert/strict";
import { test } from "node:test";
import {
  budgetAmounts,
  budgetProfiles,
  budgetSpending,
  transferShare,
} from "../lib/budget-plan";

test("transfers points only between the chosen groups", () => {
  const { shares } = budgetProfiles[1];
  assert.deepEqual(transferShare(shares, "essentials", "future", 65), {
    essentials: 65,
    future: 15,
    leisure: 10,
    development: 10,
  });
  assert.equal(
    transferShare(shares, "essentials", "future", 100).essentials,
    80,
  );
  assert.equal(transferShare(shares, "essentials", "future", -5).future, 80);
});

test("allocates every cent and keeps unknown expenses visible separately", () => {
  for (const { shares } of budgetProfiles) {
    assert.equal(
      Object.values(shares).reduce<number>((a, b) => a + b, 0),
      100,
    );
    const allocated = budgetAmounts(500003, shares);
    assert.equal(
      Object.values(allocated).reduce((a, b) => a + b),
      500003,
    );
  }
  assert.deepEqual(
    budgetSpending(
      [
        { kind: "income", category: "Mercado", amount: 100 },
        { kind: "expense", category: "Mercado", amount: 250 },
        { kind: "expense", category: "Educação", amount: 300 },
        { kind: "expense", category: "Outros", amount: 500 },
      ],
      { Educação: "essentials" },
    ),
    {
      groups: { essentials: 550, future: 0, leisure: 0, development: 0 },
      unassigned: 500,
    },
  );
});
