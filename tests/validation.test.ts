import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateSchema,
  monthSchema,
  entrySchema,
  safeNext,
} from "../lib/validation";
const entry = {
  kind: "expense",
  description: "Luz",
  amount: 18700,
  category: "Contas",
  person: "Douglas",
  date: "2026-11-05",
};
test("rejects impossible dates and accepts leap years", () => {
  for (const v of [
    "2026-02-29",
    "2026-04-31",
    "2026-00-10",
    "2026-11-00",
    "2099-13-01",
  ])
    assert.equal(dateSchema.safeParse(v).success, false, v);
  assert.equal(dateSchema.safeParse("2028-02-29").success, true);
  assert.equal(monthSchema.safeParse("2026-13").success, false);
});
test("requires integer positive centavos and complete fields", () => {
  assert.equal(entrySchema.safeParse(entry).success, true);
  for (const amount of [0, -1, 1.1, NaN, 1_000_000_001])
    assert.equal(entrySchema.safeParse({ ...entry, amount }).success, false);
  assert.equal(
    entrySchema.safeParse({ ...entry, description: "  " }).success,
    false,
  );
  assert.equal(
    entrySchema.safeParse({ ...entry, kind: "income", repeats: true }).success,
    true,
  );
});
test("recurring income preserves the first receipt status and requires a boolean repeat flag", () => {
  for (const confirmed of [true, false]) {
    const parsed = entrySchema.parse({
      ...entry,
      kind: "income",
      repeats: true,
      confirmed,
    });
    assert.equal(parsed.repeats, true);
    assert.equal(parsed.confirmed, confirmed);
  }
  assert.equal(
    entrySchema.safeParse({ ...entry, kind: "income", repeats: "true" })
      .success,
    false,
  );
});
test("auth redirects remain same-origin paths", () => {
  for (const path of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/\nevil",
  ])
    assert.equal(safeNext(path), "/");
  assert.equal(safeNext("/invite?token=abc"), "/invite?token=abc");
});

test("payment status is a boolean and edits can preserve the original status", () => {
  assert.equal(
    entrySchema.parse({ ...entry, confirmed: false }).confirmed,
    false,
  );
  assert.equal(
    entrySchema.safeParse({ ...entry, confirmed: "false" }).success,
    false,
  );
});

test("installment payloads reject incompatible modes, totals, counts and out-of-range final dates", async () => {
  const { installmentSchema } = await import("../lib/validation");
  const parcel = {
    ...entry,
    installmentCount: 3,
    installmentMode: "total",
    installmentGroup: "00000000-0000-4000-8000-000000000007",
  };
  assert.equal(installmentSchema.safeParse(parcel).success, true);
  assert.equal(
    installmentSchema.safeParse({
      ...parcel,
      installmentMode: "per_installment",
    }).success,
    true,
  );
  for (const change of [
    { kind: "income" },
    { repeats: true },
    { installmentCount: 1 },
    { installmentCount: 2.5 },
    { installmentCount: 121 },
    { amount: 2 },
    { date: "2099-12-01" },
    { installmentGroup: "invalid" },
    { installmentMode: "unknown" },
    { amount: 1_000_000_000, installmentMode: "per_installment" },
  ])
    assert.equal(
      installmentSchema.safeParse({ ...parcel, ...change }).success,
      false,
      JSON.stringify(change),
    );
});
