import { test } from "node:test";
import assert from "node:assert/strict";
import { plans } from "../lib/plans";
import { acquisitionSchema, adminMutationSchema } from "../lib/commercial";
test("billing totals and advertised savings match each period", () => {
  for (const p of plans) {
    assert.equal(p.monthly * p.months, p.total);
    assert.equal(1490 * p.months - p.total, p.saving);
  }
  assert.equal(plans[2].total, 15480);
});
test("acquisition accepts safe source data and rejects private query strings or invalid cycles", () => {
  assert.equal(
    acquisitionSchema.safeParse({
      source: "google",
      medium: "cpc",
      landing: "/financas-para-casal",
      cycle: "yearly",
    }).success,
    true,
  );
  assert.equal(
    acquisitionSchema.safeParse({ landing: "/invite?token=secret" }).success,
    false,
  );
  assert.equal(
    acquisitionSchema.safeParse({ cycle: "lifetime" }).success,
    false,
  );
});
test("admin mutations reject unsupported paid grants and incomplete leads", () => {
  assert.equal(
    adminMutationSchema.safeParse({
      action: "paid",
      household: "00000000-0000-4000-8000-000000000001",
    }).success,
    false,
  );
  assert.equal(
    adminMutationSchema.safeParse({
      action: "lead",
      id: null,
      name: "X",
      email: "bad",
      phone: "",
      stage: "new",
      notes: "",
    }).success,
    false,
  );
});
