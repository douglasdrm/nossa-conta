import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxEntitlementPreview } from "../lib/sandbox-entitlement";

test("only paid sandbox orders produce a Premium preview", () => {
  const base = {cycle:"monthly" as const,created_at:"2026-11-13T14:30:00.000Z",updated_at:"2026-11-13T14:30:00.000Z"};
  assert.deepEqual(sandboxEntitlementPreview({...base,status:"pending"}), {state:"inactive",validUntil:null});
  assert.deepEqual(sandboxEntitlementPreview({...base,status:"paid"},new Date("2026-11-14T00:00:00Z")),{
    state:"active",validUntil:"2026-12-13T14:30:00.000Z"
  });
  assert.equal(sandboxEntitlementPreview({...base,status:"paid"},new Date("2027-01-01T00:00:00Z")).state,"expired");
});

test("simulated validity is clamped for month ends and each cycle", () => {
  const base = {status:"paid",created_at:"2026-01-31T15:00:00.000Z",updated_at:"2026-01-31T15:00:00.000Z"};
  assert.equal(sandboxEntitlementPreview({...base,cycle:"monthly"},new Date("2026-02-01")).validUntil,"2026-02-28T15:00:00.000Z");
  assert.equal(sandboxEntitlementPreview({...base,cycle:"quarterly"},new Date("2026-02-01")).validUntil,"2026-04-30T15:00:00.000Z");
  assert.equal(sandboxEntitlementPreview({...base,cycle:"yearly"},new Date("2026-02-01")).validUntil,"2027-01-31T15:00:00.000Z");
});
