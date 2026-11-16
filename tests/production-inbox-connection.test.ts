import assert from "node:assert/strict";
import { test } from "node:test";
import {
  committedProductionInboxExecutor,
  createProductionInboxConnection,
} from "../lib/production-inbox-connection";
import { restrictedProductionInboxAdapter } from "../lib/production-inbox-adapter";

const event = { id: "evt_connection_fixture", type: "PAYMENT_RECEIVED", paymentId: "pay_fixture" } as const;

test("waits for COMMIT and uses the same connection for the restricted role and gateway", async () => {
  const calls: string[] = [];
  let commitStarted!: () => void;
  let finishCommit!: () => void;
  const started = new Promise<void>((resolve) => { commitStarted = resolve; });
  const pending = new Promise<void>((resolve) => { finishCommit = resolve; });
  const persist = restrictedProductionInboxAdapter(committedProductionInboxExecutor(async () => ({
    async query(sql, parameters) {
      calls.push(sql);
      if (sql === "COMMIT") {
        commitStarted();
        await pending;
      }
      if (sql.startsWith("select")) {
        assert.match(sql, /enqueue_production_event_gateway/);
        assert.deepEqual(parameters, [event.id, event.type, event.paymentId]);
      }
      return { command: sql, rows: [{ outcome: "queued" }] };
    },
    release(destroy) { calls.push(`release:${destroy}`); },
  })));

  let acknowledged = false;
  const delivery = persist(event).then((outcome) => { acknowledged = true; return outcome; });
  await started;
  assert.equal(acknowledged, false);
  assert.equal(calls[0], "BEGIN");
  assert.equal(calls[1], "SET LOCAL ROLE nc_production_inbox_executor");
  assert.equal(calls[3], "COMMIT");
  assert.equal(calls.length, 4);
  finishCommit();
  assert.equal(await delivery, "queued");
  assert.equal(calls[4], "release:false");
});

test("failed or rolled-back COMMIT never acknowledges and discards the client", async () => {
  for (const throws of [true, false]) {
    const calls: string[] = [];
    const persist = restrictedProductionInboxAdapter(committedProductionInboxExecutor(async () => ({
      async query(sql) {
        calls.push(sql);
        if (sql === "COMMIT" && throws) throw new Error("database unavailable");
        if (sql === "ROLLBACK") throw new Error("rollback unavailable");
        return { command: sql === "COMMIT" ? "ROLLBACK" : sql, rows: [{ outcome: "queued" }] };
      },
      release(destroy) { calls.push(`release:${destroy}`); },
    })));

    await assert.rejects(persist(event), throws ? /database unavailable/ : /did not commit/);
    assert.deepEqual(calls.slice(-3), ["COMMIT", "ROLLBACK", "release:true"]);
  }
});

test("limits the factory to the Supabase shared pooler and requires explicit credentials", async () => {
  const options = {
    host: "aws-0-us-east-1.pooler.supabase.com",
    projectRef: "abcdefghijklmnopqrst",
    password: "fixture-only",
  };
  for (const override of [
    { host: "pooler.supabase.com.example.com" },
    { projectRef: "postgres" },
    { password: "" },
  ]) {
    assert.throws(() => createProductionInboxConnection({ ...options, ...override }), /Invalid Supabase/);
  }
  await createProductionInboxConnection(options).close();
});
