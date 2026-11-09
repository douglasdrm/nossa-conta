import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annualPeriods,
  monthlyPeriods,
  annualTotals,
  upcomingEnd,
} from "../lib/finance-reports";

test("seven-day window includes today and crosses month and year boundaries", () => {
  assert.equal(upcomingEnd("2026-11-28"), "2026-12-04");
  assert.equal(upcomingEnd("2026-12-29"), "2027-01-04");
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
