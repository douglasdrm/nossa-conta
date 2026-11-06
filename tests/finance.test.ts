import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maskMoneyInput,
  moneyInputToCents,
  moneyInputFromCents,
  financeTotals,
  paymentState,
  dateInSaoPaulo,
} from "../lib/finance";
test("automatic decimal places use integer centavos and preserve grouped amounts", () => {
  const cases = [
    ["1", "0,01", 1],
    ["12", "0,12", 12],
    ["123", "1,23", 123],
    ["12345", "123,45", 12345],
    ["123456", "1.234,56", 123456],
    ["R$ 1.234,56", "1.234,56", 123456],
    ["", "", 0],
  ] as const;
  for (const [input, formatted, cents] of cases) {
    assert.equal(maskMoneyInput(input), formatted);
    assert.equal(moneyInputToCents(formatted), cents);
    if (cents) assert.equal(moneyInputFromCents(cents), formatted);
  }
  let input = "";
  for (const digit of "18700") input = maskMoneyInput(input + digit);
  assert.equal(input, "187,00");
  assert.equal(maskMoneyInput("187,0"), "18,70");
});
test("pending expenses do not count as paid or reduce actual balance", () => {
  const rows = [
    { kind: "income", amount: 500000, date: "2026-11-05", confirmed: true },
    { kind: "expense", amount: 5000, date: "2026-11-05", confirmed: true },
    { kind: "expense", amount: 18700, date: "2026-11-06", confirmed: false },
  ];
  assert.deepEqual(financeTotals(rows), {
    income: 500000,
    paid: 5000,
    pending: 18700,
  });
  rows[2].confirmed = true;
  assert.deepEqual(financeTotals(rows), {
    income: 500000,
    paid: 23700,
    pending: 0,
  });
});
test("due and overdue reminders respect Sao Paulo dates and exclude paid entries", () => {
  assert.equal(dateInSaoPaulo(new Date("2026-11-06T02:59:59Z")), "2026-11-05");
  assert.equal(dateInSaoPaulo(new Date("2026-11-06T03:00:00Z")), "2026-11-06");
  const row = {
    kind: "expense",
    amount: 18700,
    date: "2026-11-05",
    confirmed: false,
  };
  assert.equal(paymentState(row, "2026-11-04"), "pending");
  assert.equal(paymentState(row, "2026-11-05"), "due");
  assert.equal(paymentState(row, "2026-11-06"), "overdue");
  assert.equal(paymentState({ ...row, confirmed: true }, "2026-11-06"), "paid");
});

test("month forecast includes all unpaid commitments without subtracting paid expenses twice", async () => {
  const { monthForecast } = await import("../lib/finance");
  const rows = [
    { kind: "income", amount: 300000, date: "2026-11-01", confirmed: true },
    { kind: "expense", amount: 50000, date: "2026-11-02", confirmed: true },
    { kind: "expense", amount: 280000, date: "2026-11-30", confirmed: false },
  ];
  assert.equal(monthForecast(rows).current, 250000);
  assert.equal(monthForecast(rows).projected, -30000);
  rows[2].confirmed = true;
  assert.equal(monthForecast(rows).projected, -30000);
  assert.equal(monthForecast(rows.slice(1)).projected, -330000);
  assert.equal(monthForecast([]).projected, 0);
});

test("installments preserve every cent and original monthly due day", async () => {
  const { installmentAmounts, installmentDate } = await import(
    "../lib/finance"
  );
  assert.deepEqual(installmentAmounts(10000, 3, "total"), {
    total: 10000,
    amounts: [3334, 3333, 3333],
  });
  assert.deepEqual(installmentAmounts(10000, 3, "per_installment"), {
    total: 30000,
    amounts: [10000, 10000, 10000],
  });
  assert.deepEqual(
    [0, 1, 2].map((i) => installmentDate("2027-01-31", i)),
    ["2027-01-31", "2027-02-28", "2027-03-31"],
  );
  assert.equal(installmentDate("2028-01-31", 1), "2028-02-29");
  assert.equal(installmentDate("2026-12-15", 1), "2027-01-15");
  for (const count of [0, 1, 121, 2.5, NaN])
    assert.equal(installmentAmounts(10000, count, "total"), null);
  assert.equal(installmentAmounts(2, 3, "total"), null);
  assert.equal(installmentAmounts(1_000_000_000, 3, "per_installment"), null);
});
