import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const { committedProductionInboxExecutor } = require("../../lib/production-inbox-connection.ts");
const { restrictedProductionInboxAdapter } = require("../../lib/production-inbox-adapter.ts");
const { prepareDurableProductionDelivery } = require("../../lib/production-durable-delivery.ts");
const database = {
  host: "127.0.0.1",
  port: 5432,
  database: "nc_inbox_ci",
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
};

async function provisionNeon() {
  assert.equal(process.env.VERCEL_ENV, "preview");
  assert.equal(process.env.VERCEL_GIT_COMMIT_REF, "test/asaas-vercel-neon");
  const origin = "https://claimable.neon.tech";
  async function request(path, options) {
    const response = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error("Neon provisioning " + path.split("/").at(-1) + ": HTTP " + response.status);
    return response.json();
  }
  const registration = await request("/v1/agent/identity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "anonymous",
      capabilities: ["postgres"],
      source: "Codex",
      project_name: "nossa-conta-webhook-test",
    }),
  });
  assert.ok(typeof registration.identity_assertion === "string", "Neon identity is missing");
  assert.ok(typeof registration.project?.id === "string", "Neon project ID is missing");
  const token = await request("/v1/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: registration.identity_assertion,
      resource: origin + "/",
    }),
  });
  assert.ok(typeof token.access_token === "string", "Neon access token is missing");
  const credentials = await request("/v1/projects/" + encodeURIComponent(registration.project.id) + "/credentials", {
    headers: { Authorization: "Bearer " + token.access_token },
  });
  if (typeof credentials.database_url !== "string" ||
      !/^postgres(?:ql)?:\/\//.test(credentials.database_url)) {
    throw new Error("Neon returned no PostgreSQL connection");
  }
  const url = new URL(credentials.database_url);
  if (!url.hostname.endsWith(".neon.tech")) throw new Error("Unexpected Neon host");
  return {
    ...database,
    host: url.hostname.replace(/-pooler\./, "."),
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 20_000,
  };
}

test("webhook adapter uses a restricted network login and acknowledges committed events", {
  timeout: 240_000,
}, async () => {
  const onNeon = process.env.NC_TEST_NEON === "1";
  const connection = onNeon ? await provisionNeon() : {
    ...database, user: "postgres", password: process.env.NC_CI_POSTGRES_PASSWORD,
  };
  const owner = new Client(connection);
  const password = randomBytes(24).toString("hex");
  const newWriter = () => new Client({ ...connection, user: "nc_ci_webhook", password });
  let writer = newWriter();
  let discardedWriter;
  await owner.connect();
  try {
    // Only the disposable CI container or a newly provisioned Neon database is targeted.
    await owner.query(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema auth;
      create table auth.users (
        id uuid primary key, email text, email_confirmed_at timestamptz,
        is_anonymous boolean default false, raw_user_meta_data jsonb,
        created_at timestamptz default now()
      );
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as
        $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      grant usage on schema auth to authenticated, anon;
      create schema storage;
      create table storage.buckets (
        id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(), bucket_id text, name text
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated, anon;
      grant select, insert, delete on storage.objects to authenticated;
    `);
    const directory = "supabase/migrations";
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      await owner.query(await readFile(directory + "/" + file, "utf8"));
    }
    await owner.query(`
      create role nc_ci_webhook login noinherit password '${password}';
      grant nc_production_inbox_executor to nc_ci_webhook with inherit false, set true;
    `);
    await writer.connect();

    const secret = randomBytes(24).toString("hex");
    const event = {
      id: "evt_ci_" + randomUUID(),
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_ci_fixture" },
    };
    const deliver = (payload, persist) => prepareDurableProductionDelivery({
      explicitlyEnabled: true,
      webhookSecret: secret,
      receivedToken: secret,
      rawBody: JSON.stringify(payload),
    }, persist);
    const count = async (id) => (await owner.query(
      "select count(*)::int as total from nossa_conta_private.nc_production_event_inbox where event_id = $1",
      [id],
    )).rows[0].total;

    const persist = restrictedProductionInboxAdapter(committedProductionInboxExecutor(async () => ({
      query: (sql, parameters) => writer.query(sql, parameters),
      release(destroy) {
        // This harness owns its client. A discarded connection is replaced before a retry.
        if (destroy) discardedWriter = writer;
      },
    })));

    const table = "nossa_conta_private.nc_production_event_inbox";
    await writer.query("set role nc_production_inbox_executor");
    for (const sql of [
      "select * from " + table,
      "delete from " + table + " where false",
      "select nossa_conta_private.claim_production_event_internal()",
      "update nossa_conta_private.nc_production_inbox_control set enabled = true where false",
    ]) {
      await assert.rejects(writer.query(sql), { code: "42501" });
    }
    await writer.query("reset role");

    assert.equal((await deliver(event, persist)).reason, "production_inbox_disabled");
    assert.equal(await count(event.id), 0);
    await owner.query("update nossa_conta_private.nc_production_inbox_control set enabled = true");

    const first = await deliver(event, persist);
    assert.equal(first.status, 200);
    assert.equal(first.acknowledged, true);
    assert.equal(await count(event.id), 1);
    const replay = await deliver(event, persist);
    assert.equal(replay.status, 200);
    assert.equal(replay.reason, "matching_event_already_persisted");
    assert.equal(await count(event.id), 1);
    const conflict = await deliver({ ...event, event: "PAYMENT_REFUNDED" }, persist);
    assert.equal(conflict.status, 409);

    // A deferred constraint trigger fails at COMMIT, after the gateway returned.
    await owner.query(`
      create function nossa_conta_private.nc_ci_fail_commit() returns trigger language plpgsql
      as $$begin raise exception 'simulated commit failure'; end;$$;
      create constraint trigger nc_ci_fail_commit
      after insert on nossa_conta_private.nc_production_event_inbox
      deferrable initially deferred
      for each row when (new.event_id = 'evt_ci_commit_failure')
      execute function nossa_conta_private.nc_ci_fail_commit();
    `);
    const retryEvent = { ...event, id: "evt_ci_commit_failure" };
    const failed = await deliver(retryEvent, persist);
    assert.equal(failed.status, 503);
    assert.equal(failed.acknowledged, false);
    assert.equal(await count(retryEvent.id), 0);
    assert.equal(discardedWriter, writer);
    await writer.end();
    writer = newWriter();
    await writer.connect();
    await owner.query("drop trigger nc_ci_fail_commit on " + table);
    assert.equal((await deliver(retryEvent, persist)).status, 200);
    assert.equal(await count(retryEvent.id), 1);
    assert.equal((await owner.query(
      "select count(*)::int as total from nossa_conta_private.nc_production_charges",
    )).rows[0].total, 0);
  } finally {
    await Promise.allSettled([writer.end(), owner.end()]);
  }
});
