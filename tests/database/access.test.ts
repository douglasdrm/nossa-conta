import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("trial expiry preserves records, pauses shared access and paid Premium restores three members", async () => {
  const db = new PGlite();
  const owner = "71000000-0000-4000-8000-000000000001";
  const members = ["71000000-0000-4000-8000-000000000002", "71000000-0000-4000-8000-000000000003"];
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,raw_user_meta_data jsonb,created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      grant usage on schema auth to authenticated,anon;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated,anon;
      grant select,insert,delete on storage.objects to authenticated;
    `);
    for (const file of (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    }
    for (const [index, id] of [owner, ...members].entries()) {
      await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `person${index}@example.test`]);
    }
    async function as(id: string) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, is_anonymous: false })]);
      await db.exec("set role authenticated");
    }
    async function access() {
      return (await db.query<{ value: { kind: string; premium: boolean; can_access: boolean } }>("select nc_access_status() as value")).rows[0].value;
    }
    await as(owner);
    const household = (await db.query<{ value: string }>("select nc_ensure_household() as value")).rows[0].value;
    assert.equal((await access()).kind, "trial");
    const entry = { kind: "expense", description: "Conta preservada", amount: 1000, category: "Contas e serviços", person: "Responsável", date: "2026-11-18", repeats: false };
    await db.query("select nc_add_entry($1)", [entry]);
    await db.query("select nc_add_entry($1)", [{ ...entry, repeats: true, description: "Recorrente" }]);
    for (const [index, member] of members.entries()) {
      await as(owner);
      const token = (await db.query<{ token: string }>("select nc_create_household_invite($1) as token", [`person${index+1}@example.test`])).rows[0].token;
      await as(member);
      await db.query("select nc_ensure_household()");
      await db.query("select nc_accept_household_invite($1)", [token]);
      assert.equal((await access()).premium, true);
    }
    assert.equal((await db.query("select * from nc_household_members")).rows.length, 3);
    await db.exec("reset role");
    const token = "access-fixture-checkout-token-at-least-32-characters";
    await db.query("insert into nossa_conta_private.nc_pilot_checkout_offers(user_id) values($1)", [owner]);
    await db.query("update nossa_conta_private.nc_production_checkout_control set enabled=true,token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')", [token]);
    await db.exec("update nossa_conta_private.nc_production_inbox_control set enabled=true; update nossa_conta_private.nc_production_reconciliation_control set enabled=true;");
    await as(owner);
    assert.equal((await db.query<{ value: number }>("select nc_pilot_offer_amount() as value")).rows[0].value, 500);
    const reserved = (await db.query<{ value: { amount_cents: number } }>("select nc_reserve_production_checkout($1,'monthly','pix') as value", [token])).rows[0].value;
    assert.equal(reserved.amount_cents, 500);
    await assert.rejects(db.query("insert into nossa_conta_private.nc_pilot_checkout_offers(user_id) values($1)", [members[0]]), /permission denied/);
    await as(members[0]);
    assert.equal((await db.query<{ value: number | null }>("select nc_pilot_offer_amount() as value")).rows[0].value, null);
    await db.exec("reset role");
    await db.query("update nossa_conta_private.nc_account_trials set started_at=now()-interval '8 days',expires_at=now()-interval '1 day' where user_id=$1", [owner]);
    await as(owner);
    assert.equal((await access()).kind, "free");
    await db.query("select nc_add_entry($1)", [{ ...entry, description: "Gasto básico" }]);
    await assert.rejects(db.query("select nc_add_entry($1)", [{ ...entry, repeats: true }]), /premium_required/);
    await assert.rejects(db.query("select nc_add_installments($1)", [{ ...entry, installmentCount: 2, installmentMode: "total", installmentGroup: "72000000-0000-4000-8000-000000000001" }]), /premium_required/);
    await assert.rejects(db.query("select nc_mutate_savings($1)", [{ action: "buffer", amount: 100 }]), /premium_required/);
    await assert.rejects(db.query("select nc_create_household_invite('fourth@example.test')"), /premium_required/);
    assert.equal((await db.query("select * from nc_entries where description='Conta preservada'")).rows.length, 1);
    for (const member of members) {
      await as(member);
      assert.equal((await access()).can_access, false);
      assert.equal((await db.query("select * from nc_entries")).rows.length, 0);
      assert.equal((await db.query<{ value: string }>("select nc_ensure_household() as value")).rows[0].value, household);
      await assert.rejects(db.query("select nc_add_entry($1)", [entry]), /membership_required/);
    }
    await db.exec("reset role");
    await db.query(`insert into nossa_conta_private.nc_production_charges(household_id,provider_payment_id,cycle,status,amount_cents,due_date,paid_until,provider_verified_at)
      values($1,'pay_access_paid','monthly','RECEIVED',500,current_date,now()+interval '1 month',now())`, [household]);
    for (const member of [owner, ...members]) {
      await as(member);
      assert.equal((await access()).kind, "paid");
      assert.equal((await access()).can_access, true);
      assert.equal((await db.query("select * from nc_household_members")).rows.length, 3);
    }
    await db.exec("reset role");
    await db.query("update nossa_conta_private.nc_production_charges set status='REFUNDED' where provider_payment_id='pay_access_paid'");
    await as(members[0]);
    assert.equal((await access()).can_access, false);
    await as(owner);
    assert.equal((await db.query<{ value: number | null }>("select nc_pilot_offer_amount() as value")).rows[0].value, null);
    await db.exec("reset role");
    await db.query("insert into nc_subscriptions(household_id,valid_until,reason,granted_by) values($1,now()+interval '1 day','Cortesia de teste',$2)", [household, owner]);
    await as(members[0]);
    assert.equal((await access()).kind, "courtesy");
    assert.equal((await access()).can_access, true);
    await assert.rejects(db.query("update nossa_conta_private.nc_account_trials set expires_at=now()+interval '1 year'"), /permission denied/);
  } finally {
    await db.close();
  }
});
