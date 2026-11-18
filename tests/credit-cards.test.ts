import assert from "node:assert/strict";
import test from "node:test";
import { cardDay, firstInvoiceMonth, suggestedClosingDay } from "../lib/credit-cards";
test("card closing boundaries, due month and short months", () => {
  assert.equal(firstInvoiceMonth("2026-11-24", 25, 5), "2026-12");
  assert.equal(firstInvoiceMonth("2026-11-25", 25, 5), "2026-12");
  assert.equal(firstInvoiceMonth("2026-11-26", 25, 5), "2027-01");
  assert.equal(firstInvoiceMonth("2026-11-05", 5, 12), "2026-11");
  assert.equal(firstInvoiceMonth("2026-11-06", 5, 12), "2026-12");
  assert.equal(firstInvoiceMonth("2028-02-29", 31, 5), "2028-03");
  assert.equal(cardDay("2028-02", 31), "2028-02-29");
  assert.equal(cardDay("2027-02", 31), "2027-02-28");
  assert.equal(suggestedClosingDay(12), 5);
  assert.equal(suggestedClosingDay(5), 29);
});
