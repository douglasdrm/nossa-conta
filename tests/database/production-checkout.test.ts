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
      grant usage on schema nossa_conta_private to authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz, is_anonymous boolean);
      create table public.nc_households(id uuid primary key, owner_id uuid);
      create table public.nc_household_members(household_id uuid, user_id uuid);
      create table public.nc_subscriptions(household_id uuid, valid_until timestamptz, kind text);
      create function nossa_conta_private.is_system_admin() returns boolean language sql as $$select false$$;
      insert into auth.users values ('${owner}',now(),false), ('${member}',now(),false);
      insert into public.nc_households values ('${household}','${owner}');
      insert into public.nc_household_members values ('${household}','${owner}'), ('${household}','${member}');
    `);
    for (const migration of [
      "20261116095000_production_premium_shadow_foundation.sql",
      "20261116150000_dormant_production_reconciliation.sql",
      "20261116180000_dormant_production_event_inbox.sql",
      "20261116190044_production_checkout_orders.sql",
      "20261116194246_confirm_production_checkout_payment.sql",
      "20261116200408_production_payment_worker.sql",
    ]) {
      await db.exec(await readFile("supabase/migrations/" + migration, "utf8"));
    }
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
    const confirm = async (id = order.id, checkout = "checkout_fixture", amount = 1490,
      subscription: string | null = null, payment = "pay_fixture") => (await db.query<{ result: { status: string; valid_until?: string } }>(
      `select public.nc_confirm_production_checkout_payment(
         $1,$2,$3,$4,$5,$6,(now() at time zone 'America/Sao_Paulo')::date,'RECEIVED'
       ) as result`, [token,id,checkout,payment,subscription,amount],
    )).rows[0].result;
    await as(member);
    assert.equal((await confirm()).status, "unavailable");
    await as(owner);
    assert.equal((await confirm(order.id, "checkout_wrong")).status, "manual_review");
    assert.equal((await confirm(order.id, "checkout_fixture", 1)).status, "manual_review");
    const pix = await confirm();
    assert.equal(pix.status, "confirmed");
    assert.ok(pix.valid_until);
    assert.deepEqual(await confirm(), pix);
    assert.equal((await reserve()).status, "already_subscribed");
    await as(member);
    const memberAccess = await db.query("select public.nc_production_paid_premium_until() as valid_until");
    assert.ok(memberAccess.rows[0].valid_until);
    await as("10000000-0000-4000-8000-000000000003");
    const outsiderAccess = await db.query<{ valid_until: string | null }>("select public.nc_production_paid_premium_until() as valid_until");
    assert.equal(outsiderAccess.rows[0].valid_until, null);
    await db.exec("reset role");
    assert.equal((await db.query("select 1 from nossa_conta_private.nc_production_charges")).rows.length, 1);
    await db.exec(`
      update nossa_conta_private.nc_production_charges set paid_until=now()-interval '1 day';
      update nossa_conta_private.nc_production_checkout_orders set expires_at=now()-interval '1 minute';
    `);
    await as(owner);
    const card = await reserve(token, "card");
    assert.equal(card.status, "ready");
    await db.query("select public.nc_attach_production_checkout($1,$2,'checkout_card01')", [token,card.id]);
    const settledCard = await confirm(card.id, "checkout_card01", 1490, "sub_fixture01", "pay_card01");
    assert.equal(settledCard.status, "confirmed");
    assert.deepEqual(await confirm(card.id, "checkout_card01", 1490, "sub_fixture01", "pay_card01"), settledCard);
    await db.exec("reset role");
    assert.equal((await db.query("select 1 from nossa_conta_private.nc_production_subscription_links where status='active'")).rows.length, 1);
    assert.equal((await db.query("select 1 from nossa_conta_private.nc_production_charges")).rows.length, 2);
    await as(owner);
    await assert.rejects(db.query("select * from nossa_conta_private.nc_production_checkout_orders"), /permission denied/);
    await db.exec("reset role");
    await db.exec("select nossa_conta_private.enqueue_production_event_internal('evt_refund_fixture','PAYMENT_REFUNDED','pay_card01')");
    await db.exec("set role nc_production_payment_worker");
    const claim = await db.query<{ result: { payment_id: string; attempts: number } }>(
      "select nossa_conta_private.payment_worker_claim() as result");
    assert.equal(claim.rows[0].result.payment_id, "pay_card01");

    await assert.rejects(db.query("select * from nossa_conta_private.nc_production_charges"), /permission denied/);
    const evidence = {
      kind: "reversal", paymentId: "pay_card01", subscriptionId: "sub_fixture01",
      amountCents: 1490, status: "REFUNDED",
    };
    const finish = async (attempt: number) => (await db.query<{ result: string }>(
      `select nossa_conta_private.payment_worker_finish('evt_refund_fixture',$1,'apply',
        $2::jsonb || jsonb_build_object('dueDate',(now() at time zone 'America/Sao_Paulo')::date)) as result`,
      [attempt, JSON.stringify(evidence)],
    )).rows[0].result;
    assert.equal(await finish(2), "not_leased");
    assert.equal(await finish(1), "processed");
    assert.equal(await finish(1), "not_leased");

    await as(owner);
    assert.equal((await db.query<{ valid_until: string | null }>(
      "select public.nc_production_paid_premium_until() as valid_until",
    )).rows[0].valid_until, null);
  } finally {
    await db.close();
  }
});
