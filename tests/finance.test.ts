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
