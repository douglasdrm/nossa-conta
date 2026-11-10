import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annualPeriods,
  monthlyPeriods,
  annualTotals,
  upcomingEnd,
  emptySpendingTotals,
  addSpendingEntry,
} from "../lib/finance-reports";

test("seven-day window includes today and crosses month and year boundaries", () => {
  assert.equal(upcomingEnd("2026-11-28"), "2026-12-04");
  assert.equal(upcomingEnd("2026-12-29"), "2027-01-04");
});

test("spending separates paid and pending without inflating categories or payment methods", () => {
  const totals = emptySpendingTotals();
  addSpendingEntry(totals, {
    amount: 95052,
    confirmed: true,
    category: "Cartão de Crédito",
    payment_method: "credit_card",
  });
  addSpendingEntry(totals, {
    amount: 89999,
    confirmed: true,
    category: "Contas e serviços",
    payment_method: null,
  });
  addSpendingEntry(totals, {
    amount: 15400,
    confirmed: true,
    category: "Compras",
    payment_method: "pix",
  });
  addSpendingEntry(totals, {
    amount: 8705,
    confirmed: true,
    category: "Impostos",
    payment_method: "pix",
  });
  addSpendingEntry(totals, {
    amount: 12500,
    confirmed: false,
    category: "Compras",
    payment_method: "credit_card",
  });
  addSpendingEntry(totals, {
    amount: 47400,
    confirmed: false,
    category: "Compras",
    payment_method: null,
  });
  assert.equal(totals.paid, 209156);
  assert.equal(totals.pending, 59900);
  assert.equal(totals.paid + totals.pending, 269056);
  assert.equal(totals.count, 6);
  assert.equal(totals.paidCount, 4);
  assert.equal(totals.categories.get("Compras"), 15400);
  assert.equal(totals.paymentMethods.get("credit_card"), 95052);
  assert.equal(
    [...totals.paymentMethods.values()].reduce((a, b) => a + b, 0),
    totals.paid,
  );
});

test("a pending-only month has records even when no payment was confirmed", () => {
  const empty = emptySpendingTotals();
  assert.equal(empty.count, 0);
  const pending = emptySpendingTotals();
  addSpendingEntry(pending, {
    amount: 12345,
    confirmed: false,
    category: "Moradia",
    payment_method: null,
  });
  assert.equal(pending.paid, 0);
  assert.equal(pending.pending, 12345);
  assert.equal(pending.count, 1);
  assert.equal(pending.paidCount, 0);
  assert.equal(pending.categories.size, 0);
  assert.equal(pending.paymentMethods.size, 0);
  assert.equal(empty.pending, 0);
});

test("annual comparison includes complete months and handles leap years", () => {
  assert.deepEqual(annualPeriods(2028, "2028-02-29"), {
    current: { start: "2028-01-01", end: "2028-02-29" },
    previous: { start: "2027-01-01", end: "2027-02-28" },
  });
  assert.equal(annualPeriods(2027, "2028-02-29").current.end, "2027-12-31");
  assert.deepEqual(annualPeriods(2026, "2026-11-09"), {
    current: { start: "2026-01-01", end: "2026-11-30" },
    previous: { start: "2025-01-01", end: "2025-11-30" },
  });
  assert.equal(annualPeriods(2028, "2028-02-09").current.end, "2028-02-29");
});

test("annual totals include categories present in only one period", () => {
  assert.deepEqual(
    annualTotals(
      new Map([
        ["Mercado", 25000],
        ["Pets", 10000],
      ]),
      new Map([
        ["Mercado", 30000],
        ["Viagem", 40000],
      ]),
    ),
    {
      total: 35000,
      previousTotal: 70000,
      categories: [
        { name: "Mercado", current: 25000, previous: 30000 },
        { name: "Pets", current: 10000, previous: 0 },
        { name: "Viagem", current: 0, previous: 40000 },
      ],
    },
  );
});

test("monthly comparisons include the complete selected and previous months", () => {
  assert.deepEqual(monthlyPeriods("2026-01"), {
    current: { start: "2026-01-01", end: "2026-01-31" },
    previous: { start: "2025-12-01", end: "2025-12-31" },
  });
  assert.equal(monthlyPeriods("2026-03").previous.end, "2026-02-28");
  assert.equal(monthlyPeriods("2026-04").previous.end, "2026-03-31");
  assert.equal(monthlyPeriods("2028-03").previous.end, "2028-02-29");
  assert.deepEqual(monthlyPeriods("2026-11"), {
    current: { start: "2026-11-01", end: "2026-11-30" },
    previous: { start: "2026-10-01", end: "2026-10-31" },
  });
});
