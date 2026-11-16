import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("production checkout is gated, owner-bound and idempotent for an active order", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const member = "10000000-0000-4000-8000-000000000002";
  const household = "20000000-0000-4000-8000-000000000001";
  const token = "fixture-test-token-at-least-32-characters";
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema nossa_conta_private;
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz, is_anonymous boolean);
      create table public.nc_households(id uuid primary key, owner_id uuid);
      create table public.nc_household_members(household_id uuid, user_id uuid);
      create table nossa_conta_private.nc_production_subscription_links(household_id uuid, status text);
      create table nossa_conta_private.nc_production_charges(household_id uuid, status text, paid_until timestamptz);
      create table nossa_conta_private.nc_production_inbox_control(singleton boolean, enabled boolean);
      create table nossa_conta_private.nc_production_reconciliation_control(singleton boolean, enabled boolean);
      insert into nossa_conta_private.nc_production_inbox_control values (true,false);
      insert into nossa_conta_private.nc_production_reconciliation_control values (true,false);
      insert into auth.users values ('${owner}',now(),false), ('${member}',now(),false);
      insert into public.nc_households values ('${household}','${owner}');
      insert into public.nc_household_members values ('${household}','${owner}'), ('${household}','${member}');
    `);
    await db.exec(await readFile("supabase/migrations/20261116190044_production_checkout_orders.sql", "utf8"));
    const as = async (id: string) => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    };
    type Order = { status: string; id?: string; amount_cents?: number; reused?: boolean; checkout_id?: string };
    const reserve = async (key = token, method = "pix") => (await db.query<{ result: Order }>(
      "select public.nc_reserve_production_checkout($1,'monthly',$2) as result", [key,method],
    )).rows[0].result;
    await as(owner);
    assert.equal((await reserve()).status, "unavailable");
    await db.exec("reset role");
    await db.query("update nossa_conta_private.nc_production_checkout_control set enabled=true, token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')", [token]);
    await db.exec("update nossa_conta_private.nc_production_inbox_control set enabled=true");
    await as(owner);
    assert.equal((await reserve()).status, "unavailable");
    await db.exec("reset role");
    await db.exec("update nossa_conta_private.nc_production_reconciliation_control set enabled=true");

    await as(member);
    assert.equal((await reserve()).status, "forbidden");
    await as(owner);
    assert.equal((await reserve("wrong")).status, "unavailable");
    const order = await reserve();
    assert.equal(order.status, "ready");
    assert.equal(order.amount_cents, 1490);
    assert.equal(order.reused, false);
    assert.equal((await reserve()).id, order.id);
    assert.equal((await reserve()).reused, true);
    assert.equal((await reserve(token, "card")).status, "other_checkout");

    const attach = async () => (await db.query<{ ok: boolean }>(
      "select public.nc_attach_production_checkout($1,$2,'checkout_fixture') as ok", [token,order.id],
    )).rows[0].ok;
    await as(member);
    assert.equal(await attach(), false);
    await as(owner);
    assert.equal(await attach(), true);
    assert.equal((await reserve()).checkout_id, "checkout_fixture");
    await assert.rejects(db.query("select * from nossa_conta_private.nc_production_checkout_orders"), /permission denied/);
  } finally {
    await db.close();
  }
});
