import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxEntitlementPreview } from "../lib/sandbox-entitlement";

test("only confirmed Sandbox payments have a simulated Premium period", () => {
  const base = {cycle:"monthly" as const,sandbox_valid_until:"2026-12-13T14:30:00.000Z"};
  assert.deepEqual(sandboxEntitlementPreview({...base,status:"pending"}), {state:"inactive",validUntil:null});
  assert.deepEqual(sandboxEntitlementPreview({...base,status:"paid"},new Date("2026-11-14T00:00:00Z")),{
    state:"active",validUntil:"2026-12-13T14:30:00.000Z"
  });
  assert.equal(sandboxEntitlementPreview({...base,status:"paid"},new Date("2027-01-01T00:00:00Z")).state,"expired");
});

test("a missing or invalid persisted date never activates sandbox Premium", () => {
  assert.equal(sandboxEntitlementPreview({cycle:"monthly",status:"paid",sandbox_valid_until:null}).state,"inactive");
  assert.equal(sandboxEntitlementPreview({cycle:"yearly",status:"paid",sandbox_valid_until:"wrong"}).state,"inactive");
});
