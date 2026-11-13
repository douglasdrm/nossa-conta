import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const outsider = "00000000-0000-4000-8000-000000000003";
const charlie = "00000000-0000-4000-8000-000000000004";

test("migration, household isolation, invitations and recurring month edits", async (t) => {
  const db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;
 create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,raw_user_meta_data jsonb,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 grant execute on function auth.uid() to authenticated,anon;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 grant execute on function auth.jwt() to authenticated,anon;
 grant usage on schema public to authenticated,anon;`);
  for (const [id, email] of [
    [alice, "alice@example.com"],
    [bob, "bob@example.com"],
    [outsider, "outsider@example.com"],
    [charlie, "charlie@example.com"],
  ])
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, email],
    );
  await db.exec(
    `create table public.trips(id integer primary key, title text);insert into public.trips values(1,'Sentinela Junto');alter table public.trips enable row level security;create policy trip_sentinel on public.trips for select to authenticated using(false);create function public.sync_month(p_month date) returns text language sql as $$select 'junto-sentinel'::text$$;grant select on public.trips to authenticated;`,
  );
  await db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  const migrations = (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    if (file.includes("pending_expenses")) {
      await db.exec(
        "insert into public.nc_households(id,owner_id) values('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');insert into public.nc_entries(id,household_id,kind,description,amount,category,person,date,created_by) values('legacy-test','10000000-0000-4000-8000-000000000001','expense','Conta anterior',12345,'Contas','Alice','2026-01-05','00000000-0000-4000-8000-000000000001')",
      );
    }
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    if (file.includes("pending_expenses")) {
      await t.test(
        "existing history remains confirmed with unknown payer after migration",
        async () => {
          const row = (
            await db.query<{
              confirmed: boolean;
              payer: string | null;
              amount: number;
            }>(
              "select confirmed,payer,amount::integer from public.nc_entries where id='legacy-test'",
            )
          ).rows[0];
          assert.equal(row.confirmed, true);
          assert.equal(row.payer, null);
          assert.equal(row.amount, 12345);
        },
      );
      await db.exec(
        "delete from public.nc_households where id='10000000-0000-4000-8000-000000000001'",
      );
    }
  }
  async function as(id: string, role = "authenticated") {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role, is_anonymous: id.endsWith("000006") }),
    ]);
    await db.exec("set role " + role);
  }
  async function rpc<T = unknown>(name: string, args: unknown[] = []) {
    const { rows } = await db.query<{ v: T }>(
      `select public.nc_${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as v`,
      args,
    );
    return rows[0].v;
  }
  const base = {
    kind: "expense",
    description: "Luz",
    amount: 10000,
    category: "Contas e serviços",
    person: "Alice",
    date: "2026-01-31",
    repeats: true,
  };
  let id = "",
    token = "";
  await t.test(
    "creates a household idempotently and inserts atomically",
    async () => {
      await as(alice);
      const a = await rpc("ensure_household");
      assert.equal(await rpc("ensure_household"), a);
      const e = await rpc<{ id: string }>("add_entry", [base]);
      id = e.id;
      assert.match(id, /:2026-01$/);
      await assert.rejects(() => rpc("add_entry", [{ ...base, amount: 0 }]));
      assert.equal((await db.query("select * from nc_entries")).rows.length, 1);
    },
  );
  await t.test(
    "clips day 31 to February and does not duplicate a repeated sync",
    async () => {
      await rpc("sync_month", ["2026-02-01"]);
      await rpc("sync_month", ["2026-02-01"]);
      const { rows } = await db.query<{ date: string; amount: number }>(
        "select date::text,amount::integer from nc_entries where date>='2026-02-01'",
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].date, "2026-02-28");
      assert.equal(rows[0].amount, 10000);
    },
  );
  await t.test(
    "edits one month and versions future defaults without changing history",
    async () => {
      await rpc("sync_month", ["2026-03-01"]);
      const march = id.replace("2026-01", "2026-03");
      await rpc("edit_entry", [
        march,
        { ...base, date: "2026-03-31", amount: 18700 },
        true,
      ]);
      await rpc("sync_month", ["2026-04-01"]);
      let { rows } = await db.query<{ date: string; amount: number }>(
        "select date::text,amount::integer from nc_entries order by date",
      );
      assert.deepEqual(
        rows.map((e) => e.amount),
        [10000, 10000, 18700, 18700],
      );
      await rpc("edit_entry", [id, { ...base, amount: 9500 }, false]);
      await rpc("sync_month", ["2026-05-01"]);
      rows = (
        await db.query<{ date: string; amount: number }>(
          "select date::text,amount::integer from nc_entries order by date",
        )
      ).rows;
      assert.equal(rows[0].amount, 9500);
      assert.equal(rows[4].amount, 18700);
      await assert.rejects(() =>
        rpc("edit_entry", [id, { ...base, date: "2026-02-01" }, false]),
      );
    },
  );
  await t.test(
    "an unopened historical month retains its old default after a later change",
    async () => {
      const r = await rpc<{ id: string }>("add_entry", [
        {
          ...base,
          date: "2027-01-31",
          description: "Financiamento",
          amount: 150000,
        },
      ]);
      await rpc("sync_month", ["2027-03-01"]);
      await rpc("edit_entry", [
        r.id.replace("2027-01", "2027-03"),
        {
          ...base,
          date: "2027-03-31",
          description: "Financiamento",
          amount: 151234,
        },
        true,
      ]);
      await rpc("sync_month", ["2027-02-01"]);
      await rpc("sync_month", ["2027-04-01"]);
      const old = (
        await db.query<{ amount: number }>(
          "select amount::integer from nc_entries where id=$1",
          [r.id.replace("2027-01", "2027-02")],
        )
      ).rows[0];
      const future = (
        await db.query<{ amount: number }>(
          "select amount::integer from nc_entries where id=$1",
          [r.id.replace("2027-01", "2027-04")],
        )
      ).rows[0];
      assert.equal(old.amount, 150000);
      assert.equal(future.amount, 151234);
      await rpc("stop_recurring", [r.id]);
    },
  );
  await t.test(
    "deleting a recurring occurrence does not resurrect it",
    async () => {
      const feb = id.replace("2026-01", "2026-02");
      await rpc("delete_entry", [feb]);
      await rpc("sync_month", ["2026-02-01"]);
      const r = await db.query(
        "select id from nc_entries where id=$1 and deleted_at is null",
        [feb],
      );
      assert.equal(r.rows.length, 0);
    },
  );
  await t.test("stops recurrence after selected month", async () => {
    await rpc("stop_recurring", [id.replace("2026-01", "2026-05")]);
    await rpc("sync_month", ["2026-06-01"]);
    assert.equal(
      (
        await db.query(
          "select * from nc_entries where date>='2026-06-01' and date<'2027-01-01'",
        )
      ).rows.length,
      0,
    );
  });
  await t.test(
    "isolates nc_households through RLS and checks RPC ownership",
    async () => {
      await as(outsider);
      await rpc("ensure_household");
      assert.equal((await db.query("select * from nc_entries")).rows.length, 0);
      await assert.rejects(() =>
        rpc("edit_entry", [id, { ...base, amount: 1 }, false]),
      );
      await assert.rejects(() => rpc("delete_entry", [id]));
      await assert.rejects(() =>
        db.query("insert into nc_entries(id) values('injected')"),
      );
      await as(alice);
      assert.equal(
        (await db.query("select * from nc_entries where date<'2027-01-01'"))
          .rows.length,
        5,
      );
    },
  );
  await t.test(
    "creates email-bound invites and does not expose token hashes",
    async () => {
      token = await rpc<string>("create_household_invite", ["bob@example.com"]);
      assert.match(token, /^[a-f0-9]{64}$/);
      await assert.rejects(() =>
        db.query("select token_hash from nc_household_invites"),
      );
      await as(outsider);
      await assert.rejects(() => rpc("accept_household_invite", [token]));
      await as(bob);
      await rpc("ensure_household");
      await rpc("accept_household_invite", [token]);
      assert.equal(
        (await db.query("select * from nc_entries where date<'2027-01-01'"))
          .rows.length,
        5,
      );
      assert.equal(
        await rpc("accept_household_invite", [token]),
        await rpc("ensure_household"),
      );
      await assert.rejects(() =>
        rpc("create_household_invite", ["charlie@example.com"]),
      );
    },
  );
  await t.test(
    "shared member can register an expense visible to the owner",
    async () => {
      await rpc("add_entry", [
        {
          ...base,
          repeats: false,
          date: "2026-05-05",
          description: "Mercado",
          person: "Bob",
          amount: 3520,
        },
      ]);
      await as(alice);
      const rows = (
        await db.query("select * from nc_entries where person='Bob'")
      ).rows;
      assert.equal(rows.length, 1);
    },
  );
  await t.test("revoked and expired invites cannot be accepted", async () => {
    const revoked = await rpc<string>("create_household_invite", [
      "charlie@example.com",
    ]);
    const inv = (
      await db.query<{ id: string }>(
        "select id from nc_household_invites where email='charlie@example.com' and revoked_at is null",
      )
    ).rows[0];
    await rpc("revoke_household_invite", [inv.id]);
    await as(charlie);
    await assert.rejects(() => rpc("accept_household_invite", [revoked]));
    await as(alice);
    const expired = await rpc<string>("create_household_invite", [
      "charlie@example.com",
    ]);
    await db.exec("reset role");
    await db.exec(
      "update nc_household_invites set expires_at=now()-interval '1 hour' where email='charlie@example.com'",
    );
    await as(charlie);
    await assert.rejects(() => rpc("accept_household_invite", [expired]));
  });
  await t.test(
    "a populated household is never discarded when accepting an invite",
    async () => {
      await as(alice);
      const tok = await rpc<string>("create_household_invite", [
        "outsider@example.com",
      ]);
      await as(outsider);
      await rpc("add_entry", [{ ...base, repeats: false }]);
      await assert.rejects(
        () => rpc("accept_household_invite", [tok]),
        /existing_household/,
      );
      assert.equal((await db.query("select * from nc_entries")).rows.length, 1);
    },
  );
  await t.test(
    "shares a valid budget plan only within the household",
    async () => {
      await as(alice);
      const household = await rpc<string>("ensure_household");
      const write = (
        id: string,
        essentials: number,
        categories = { Mercado: "essentials" },
      ) =>
        db.query(
          "insert into nc_budget_plan values ($1,true,$2,20,10,10,$3) on conflict (household_id) do update set essentials = excluded.essentials",
          [id, essentials, categories],
        );
      await assert.rejects(() => write(household, 61));
      await assert.rejects(() => write(household, 60, { Mercado: "unknown" }));
      await write(household, 60);
      await as(bob);
      assert.equal(
        (await db.query("select essentials from nc_budget_plan")).rows.length,
        1,
      );
      await db.query(
        "update nc_budget_plan set enabled=false where household_id=$1",
        [household],
      );
      await as(alice);
      assert.deepEqual(
        (await db.query("select enabled from nc_budget_plan")).rows,
        [{ enabled: false }],
      );
      await as(outsider);
      assert.deepEqual(
        (await db.query("select * from nc_budget_plan")).rows,
        [],
      );
      await assert.rejects(() => write(household, 60));
    },
  );
  await t.test(
    "all tables enable RLS and public RPCs are invoker functions",
    async () => {
      await db.exec("reset role");
      const tables = (
        await db.query<{ relname: string; relrowsecurity: boolean }>(
          "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'nc_%'",
        )
      ).rows;
      assert.equal(tables.length, 17);
      assert.ok(tables.some((t) => t.relname === "nc_billing_lifecycle_events"));
      assert.ok(tables.every((t) => t.relrowsecurity));
      const unsafe = (
        await db.query(
          "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.proname like 'nc_%'",
        )
      ).rows;
      assert.equal(unsafe.length, 0);
    },
  );
  await t.test("token-gated billing wrappers can reach their private functions", async () => {
    await db.exec("reset role");
    const privileges = (
      await db.query<{ link_grant: boolean; event_grant: boolean }>(
        "select has_function_privilege('anon','nossa_conta_private.billing_link_subscription(text,uuid,text,text)','EXECUTE') as link_grant, has_function_privilege('anon','nossa_conta_private.billing_lifecycle_event(text,text,text,text,text,text,integer)','EXECUTE') as event_grant"
      )
    ).rows[0];
    assert.equal(privileges.link_grant, true);
    assert.equal(privileges.event_grant, true);
  });
  await t.test("anonymous clients cannot call finance RPCs", async () => {
    await as("", "anon");
    await assert.rejects(() => rpc("ensure_household"));
    await assert.rejects(() => db.query("select * from nc_entries"));
    await as("");
    await assert.rejects(
      () => rpc("ensure_household"),
      /authentication_required/,
    );
  });
  await t.test(
    "existing Junto tables, policies and functions are preserved",
    async () => {
      await db.exec("reset role");
      assert.equal(
        (
          await db.query<{ title: string }>(
            "select title from public.trips where id=1",
          )
        ).rows[0].title,
        "Sentinela Junto",
      );
      assert.equal(
        (
          await db.query<{ v: string }>(
            "select public.sync_month('2026-01-01'::date) as v",
          )
        ).rows[0].v,
        "junto-sentinel",
      );
      await as(alice);
      assert.equal(
        (await db.query("select * from public.trips")).rows.length,
        0,
      );
    },
  );
  await t.test(
    "unconfirmed and anonymous Auth users cannot create finance spaces",
    async () => {
      await db.exec("reset role");
      await db.exec(
        "insert into auth.users(id,email,email_confirmed_at,is_anonymous) values('00000000-0000-4000-8000-000000000005','pending@example.com',null,false),('00000000-0000-4000-8000-000000000006',null,now(),true)",
      );
      await as("00000000-0000-4000-8000-000000000005");
      await assert.rejects(
        () => rpc("ensure_household"),
        /confirmed_account_required/,
      );
      await as("00000000-0000-4000-8000-000000000006");
      await assert.rejects(
        () => rpc("ensure_household"),
        /confirmed_account_required/,
      );
    },
  );
  await t.test(
    "pending payment confirmation is isolated, idempotent, reversible and recurring months stay pending",
    async () => {
      await as(alice);
      const saved = await rpc<{
        id: string;
        confirmed: boolean;
        confirmed_at: string | null;
      }>("add_entry", [
        {
          ...base,
          repeats: true,
          confirmed: false,
          date: "2028-01-31",
          description: "Conta pendente",
        },
      ]);
      assert.equal(saved.confirmed, false);
      assert.equal(saved.confirmed_at, null);
      await rpc("sync_month", ["2028-02-01"]);
      const feb = saved.id.replace("2028-01", "2028-02");
      assert.equal(
        (
          await db.query<{ confirmed: boolean }>(
            "select confirmed from nc_entries where id=$1",
            [feb],
          )
        ).rows[0].confirmed,
        false,
      );
      await rpc("confirm_entry", [saved.id, true]);
      const paid = (
        await db.query<{ confirmed: boolean; at: string }>(
          "select confirmed,confirmed_at::text as at from nc_entries where id=$1",
          [saved.id],
        )
      ).rows[0];
      assert.equal(paid.confirmed, true);
      assert.ok(paid.at);
      await rpc("confirm_entry", [saved.id, true]);
      assert.equal(
        (
          await db.query<{ at: string }>(
            "select confirmed_at::text as at from nc_entries where id=$1",
            [saved.id],
          )
        ).rows[0].at,
        paid.at,
      );
      assert.equal(
        (
          await db.query<{ confirmed: boolean }>(
            "select confirmed from nc_entries where id=$1",
            [feb],
          )
        ).rows[0].confirmed,
        false,
      );
      await rpc("edit_entry", [
        feb,
        { ...base, date: "2028-02-29", amount: 19999 },
        false,
      ]);
      assert.equal(
        (
          await db.query<{ confirmed: boolean }>(
            "select confirmed from nc_entries where id=$1",
            [feb],
          )
        ).rows[0].confirmed,
        false,
      );
      await as(outsider);
      await assert.rejects(() => rpc("confirm_entry", [saved.id, true]));
      await as(alice);
      await rpc("confirm_entry", [saved.id, false]);
      assert.equal(
        (
          await db.query<{ confirmed: boolean; at: string | null }>(
            "select confirmed,confirmed_at::text as at from nc_entries where id=$1",
            [saved.id],
          )
        ).rows[0].at,
        null,
      );
      const income = await rpc<{ id: string; confirmed: boolean }>(
        "add_entry",
        [
          {
            ...base,
            kind: "income",
            repeats: false,
            confirmed: false,
            date: "2028-01-05",
          },
        ],
      );
      assert.equal(income.confirmed, false);
      await rpc("confirm_entry", [income.id, true, "Alice"]);
      const received = (
        await db.query("select confirmed,payer from nc_entries where id=$1", [
          income.id,
        ])
      ).rows[0];
      assert.deepEqual(received, { confirmed: true, payer: null });
      await rpc("confirm_entry", [income.id, false]);
      const paidNew = await rpc<{ id: string; confirmed: boolean }>(
        "add_entry",
        [{ ...base, repeats: false, confirmed: true, date: "2028-01-05" }],
      );
      assert.equal(paidNew.confirmed, true);
      await rpc("delete_entry", [paidNew.id]);
      await assert.rejects(() => rpc("confirm_entry", [paidNew.id, true]));
    },
  );
  await t.test(
    "the payer can differ from the creator and responsible person, with no income required",
    async () => {
      await as(alice);
      const entry = await rpc<{ id: string }>("add_entry", [
        {
          ...base,
          confirmed: false,
          repeats: false,
          person: "Alice",
          date: "2029-01-05",
        },
      ]);
      await rpc("edit_entry", [
        entry.id,
        {
          ...base,
          repeats: false,
          person: "Alice",
          date: "2029-01-05",
          confirmed: true,
          payer: "Bob",
          amount: 12345,
        },
        false,
      ]);
      let row = (
        await db.query<{
          payer: string;
          person: string;
          created_by: string;
          confirmed: boolean;
        }>(
          "select payer,person,created_by,confirmed from nc_entries where id=$1",
          [entry.id],
        )
      ).rows[0];
      assert.equal(row.payer, "Bob");
      assert.equal(row.person, "Alice");
      assert.equal(row.created_by, alice);
      assert.equal(row.confirmed, true);
      await rpc("edit_entry", [
        entry.id,
        { ...base, person: "Alice", date: "2029-01-05", confirmed: false },
        false,
      ]);
      row = (
        await db.query(
          "select payer,person,created_by,confirmed from nc_entries where id=$1",
          [entry.id],
        )
      ).rows[0] as typeof row;
      assert.equal(row.payer, null);
      assert.equal(row.confirmed, false);
      await rpc("confirm_entry", [entry.id, true, "Samantha"]);
      assert.equal(
        (
          await db.query<{ payer: string }>(
            "select payer from nc_entries where id=$1",
            [entry.id],
          )
        ).rows[0].payer,
        "Samantha",
      );
    },
  );
  await t.test(
    "installments are atomic, cent-exact, independently payable, retry-safe and tenant-isolated",
    async () => {
      await as(alice);
      const group = "20000000-0000-4000-8000-000000000001";
      const parcel = {
        ...base,
        date: "2030-01-31",
        description: "Compra parcelada",
        repeats: false,
        confirmed: true,
        payer: "Bob",
        amount: 10000,
        installmentCount: 3,
        installmentMode: "total",
        installmentGroup: group,
      };
      const created = await rpc<{ id: string }>("add_installments", [parcel]);
      let rows = (
        await db.query<{
          id: string;
          amount: number;
          date: string;
          confirmed: boolean;
          payer: string | null;
          installment_number: number;
        }>(
          "select id,amount::integer,date::text,confirmed,payer,installment_number from nc_entries where installment_group=$1 order by installment_number",
          [group],
        )
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.amount),
        [3334, 3333, 3333],
      );
      assert.deepEqual(
        rows.map((r) => r.date),
        ["2030-01-31", "2030-02-28", "2030-03-31"],
      );
      assert.deepEqual(
        rows.map((r) => r.confirmed),
        [true, false, false],
      );
      assert.deepEqual(
        rows.map((r) => r.payer),
        ["Bob", null, null],
      );
      await rpc("add_installments", [parcel]);
      assert.equal(
        (
          await db.query(
            "select id from nc_entries where installment_group=$1",
            [group],
          )
        ).rows.length,
        3,
      );
      const second = rows[1].id,
        third = rows[2].id;
      await rpc("edit_entry", [
        second,
        { ...base, date: "2030-02-28", amount: 4000 },
        false,
      ]);
      await rpc("confirm_entry", [second, true, "Samantha"]);
      assert.equal(
        (
          await db.query<{ amount: number }>(
            "select amount::integer from nc_entries where id=$1",
            [third],
          )
        ).rows[0].amount,
        3333,
      );
      await rpc("delete_entry", [second]);
      await rpc("sync_month", ["2030-02-01"]);
      assert.equal(
        (
          await db.query(
            "select id from nc_entries where id=$1 and deleted_at is null",
            [second],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select id from nc_entries where id=$1 and deleted_at is null",
            [third],
          )
        ).rows.length,
        1,
      );
      const group2 = "20000000-0000-4000-8000-000000000002";
      await rpc("add_installments", [
        {
          ...parcel,
          installmentGroup: group2,
          installmentMode: "per_installment",
          confirmed: false,
        },
      ]);
      assert.equal(
        (
          await db.query<{ total: number }>(
            "select sum(amount)::integer total from nc_entries where installment_group=$1",
            [group2],
          )
        ).rows[0].total,
        30000,
      );
      const invalidGroup = "20000000-0000-4000-8000-000000000003";
      for (const change of [
        { amount: 2 },
        { repeats: true },
        { kind: "income" },
        { installmentCount: 121 },
        { installmentCount: 1 },
        { date: "2099-12-31" },
        { amount: 1000000000, installmentMode: "per_installment" },
        { payer: "x".repeat(61) },
      ])
        await assert.rejects(() =>
          rpc("add_installments", [
            { ...parcel, installmentGroup: invalidGroup, ...change },
          ]),
        );
      assert.equal(
        (
          await db.query(
            "select id from nc_entries where installment_group=$1",
            [invalidGroup],
          )
        ).rows.length,
        0,
        "invalid creation cannot leave partial installments",
      );
      await as(outsider);
      assert.equal(
        (
          await db.query(
            "select id from nc_entries where installment_group=$1",
            [group],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(() =>
        rpc("confirm_entry", [created.id, true, "Outsider"]),
      );
      await as(bob);
      assert.equal(
        (
          await db.query(
            "select id from nc_entries where installment_group=$1",
            [group],
          )
        ).rows.length,
        3,
        "shared members see the same installments",
      );
      await as("", "anon");
      await assert.rejects(() => rpc("add_installments", [parcel]));
      await as("00000000-0000-4000-8000-000000000006");
      await assert.rejects(
        () => rpc("add_installments", [parcel]),
        /confirmed_account_required/,
      );
    },
  );
  await t.test(
    "custom categories persist for shared members and remain household-isolated",
    async () => {
      await as(alice);
      assert.deepEqual(await rpc("add_category", ["expense", "  Pets  "]), {
        kind: "expense",
        name: "Pets",
      });
      assert.deepEqual(await rpc("add_category", ["expense", "pets"]), {
        kind: "expense",
        name: "Pets",
      });
      assert.equal(
        (await db.query("select * from nc_categories")).rows.length,
        1,
      );
      for (const args of [
        ["expense", " "],
        ["expense", "x".repeat(61)],
        ["other", "Pets"],
      ])
        await assert.rejects(() => rpc("add_category", args));
      await as(bob);
      assert.equal(
        (await db.query<{ name: string }>("select name from nc_categories"))
          .rows[0].name,
        "Pets",
      );
      await rpc("add_category", ["income", "Presentes"]);
      await as(alice);
      assert.equal(
        (await db.query("select * from nc_categories")).rows.length,
        2,
      );
      await as(outsider);
      assert.equal(
        (await db.query("select * from nc_categories")).rows.length,
        0,
      );
      await rpc("add_category", ["expense", "Pets"]);
      assert.equal(
        (await db.query("select * from nc_categories")).rows.length,
        1,
      );
      await as("", "anon");
      await assert.rejects(() => rpc("add_category", ["expense", "Pets"]));
      await assert.rejects(() => db.query("select * from nc_categories"));
      await as("00000000-0000-4000-8000-000000000006");
      await assert.rejects(
        () => rpc("add_category", ["expense", "Pets"]),
        /confirmed_account_required/,
      );
    },
  );
  await t.test(
    "profiles and private avatars only allow the confirmed account owner",
    async () => {
      await as(alice);
      assert.deepEqual(
        await rpc("save_profile", ["Alice Nova", "ALICE_NOVA"]),
        { display_name: "Alice Nova", username: "alice_nova" },
      );
      await assert.rejects(() => rpc("save_profile", ["", "valid_name"]));
      await assert.rejects(() => rpc("save_profile", ["Alice", "bad name"]));
      const ownPath = alice + "/11111111-1111-4111-8111-111111111111.webp";
      await rpc("set_avatar", [ownPath]);
      assert.equal(
        (
          await db.query<{ avatar_path: string }>(
            "select avatar_path from nc_user_profiles",
          )
        ).rows[0].avatar_path,
        ownPath,
      );
      await rpc("save_profile", ["Alice Atualizada", "alice_nova"]);
      assert.equal(
        (
          await db.query<{ avatar_path: string }>(
            "select avatar_path from nc_user_profiles",
          )
        ).rows[0].avatar_path,
        ownPath,
        "name edit retains photo",
      );
      await assert.rejects(() =>
        rpc("set_avatar", [bob + "/11111111-1111-4111-8111-111111111111.webp"]),
      );
      await assert.rejects(() =>
        rpc("set_avatar", ["https://outside.test/photo.png"]),
      );
      await db.query(
        "insert into storage.objects(bucket_id,name) values('nc-avatars',$1)",
        [ownPath],
      );
      await assert.rejects(() =>
        db.query(
          "insert into storage.objects(bucket_id,name) values('nc-avatars',$1)",
          [bob + "/photo.webp"],
        ),
      );
      await as(bob);
      assert.equal(
        (await db.query("select * from nc_user_profiles")).rows.length,
        0,
        "shared finances do not grant editing or reading private profile details",
      );
      assert.equal(
        (await db.query("select * from storage.objects")).rows.length,
        0,
      );
      await assert.rejects(() => rpc("save_profile", ["Bob", "alice_nova"]));
      await rpc("save_profile", ["Bob", "bob_novo"]);
      await as(alice);
      assert.equal(
        (
          await db.query<{ display_name: string }>(
            "select display_name from nc_user_profiles",
          )
        ).rows[0].display_name,
        "Alice Atualizada",
      );
      await rpc("set_avatar", [null]);
      assert.equal(
        (
          await db.query<{ avatar_path: string | null }>(
            "select avatar_path from nc_user_profiles",
          )
        ).rows[0].avatar_path,
        null,
      );
      await as("", "anon");
      await assert.rejects(() => rpc("save_profile", ["Anon", "anonymous"]));
      await assert.rejects(() => db.query("select * from nc_user_profiles"));
      await as("00000000-0000-4000-8000-000000000006");
      await assert.rejects(
        () => rpc("set_avatar", [null]),
        /confirmed_account_required/,
      );
    },
  );
  await t.test(
    "payer aliases link to a member and survive profile edits",
    async () => {
      await as(alice);
      await rpc("save_profile", ["Alice Nova", "alice_nova"]);
      const ids = [];
      for (const payer of ["alice", "Alice Nova", "alice_nova"]) {
        const row = await rpc<{ id: string; payer_user_id: string }>(
          "add_entry",
          [
            {
              ...base,
              repeats: false,
              payer,
              confirmed: true,
            },
          ],
        );
        assert.equal(row.payer_user_id, alice);
        ids.push(row.id);
      }
      await rpc("save_profile", ["Alice Silva", "alice_silva"]);
      await rpc("edit_entry", [
        ids[1],
        { ...base, repeats: false, payer: "Alice Nova", confirmed: true },
        false,
      ]);
      const row = (
        await db.query<{ payer_user_id: string }>(
          "select payer_user_id from nc_entries where id=$1",
          [ids[1]],
        )
      ).rows[0];
      assert.equal(row.payer_user_id, alice);
      const labels = await rpc<Record<string, string>>("payer_labels");
      assert.equal(labels[alice], "Alice Silva");
      await as(outsider);
      assert.equal(
        (await rpc<Record<string, string>>("payer_labels"))[alice],
        undefined,
      );
    },
  );
  await t.test(
    "stores the chosen group for new custom expense categories",
    async () => {
      await as(alice);
      await assert.rejects(() =>
        rpc("add_category", ["expense", "Academia", null]),
      );
      await assert.rejects(() =>
        rpc("add_category", ["income", "Bônus", "leisure"]),
      );
      await rpc("add_category", ["expense", "Academia", "leisure"]);
      await rpc("add_category", ["expense", "academia", "essentials"]);
      await as(bob);
      assert.deepEqual(
        (
          await db.query(
            "select budget_group from nc_categories where name='Academia'",
          )
        ).rows,
        [{ budget_group: "leisure" }],
      );
      await as(outsider);
      assert.deepEqual(
        (
          await db.query(
            "select budget_group from nc_categories where name='Academia'",
          )
        ).rows,
        [],
      );
      await as(alice);
    },
  );
  await t.test(
    "renames a custom category across entries and recurring rules",
    async () => {
      await as(alice);
      await rpc("add_category", ["expense", "Reparos", "essentials"]);
      await rpc("add_category", ["expense", "Oficina", "essentials"]);
      const entry = await rpc<{ id: string }>("add_entry", [
        { ...base, category: "Reparos", date: "2026-08-01" },
      ]);
      await as(outsider);
      await assert.rejects(
        () => rpc("rename_category", ["expense", "Reparos", "Manutenção"]),
        /category_not_found/,
      );
      await as(bob);
      await assert.rejects(
        () => rpc("rename_category", ["expense", "Reparos", "OFICINA"]),
        /category_name_taken/,
      );
      assert.deepEqual(
        await rpc("rename_category", ["expense", "Reparos", "Manutenção"]),
        { kind: "expense", name: "Manutenção" },
      );
      await as(alice);
      assert.deepEqual(
        (
          await db.query("select category from nc_entries where id=$1", [
            entry.id,
          ])
        ).rows,
        [{ category: "Manutenção" }],
      );
      assert.deepEqual(
        (
          await db.query(
            "select budget_group from nc_categories where name='Manutenção'",
          )
        ).rows,
        [{ budget_group: "essentials" }],
      );
      await rpc("sync_month", ["2026-09-01"]);
      assert.deepEqual(
        (
          await db.query("select category from nc_entries where id=$1", [
            entry.id.replace(/2026-08$/, "2026-09"),
          ])
        ).rows,
        [{ category: "Manutenção" }],
      );
    },
  );
  await t.test(
    "shared savings plans become reserves only when confirmed",
    async () => {
      const goalId = "80000000-0000-4000-8000-000000000001";
      const movementId = "80000000-0000-4000-8000-000000000002";
      const withdrawId = "80000000-0000-4000-8000-000000000003";
      const month = (
        await db.query<{ month: string }>(
          "select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date::text as month",
        )
      ).rows[0].month;
      type Overview = {
        buffer: number;
        goals: {
          saved: number;
          planned: number;
          savedInMonth: number;
          movements: { actor: string }[];
        }[];
      };
      await as(alice);
      await rpc("mutate_savings", [
        {
          action: "goal",
          goalId,
          name: "Viagem",
          target: 240000,
          deadline: "2030-12-31",
          priority: 1,
        },
      ]);
      await rpc("mutate_savings", [{ action: "buffer", amount: 5000 }]);
      const deposit = {
        action: "movement",
        goalId,
        movementId,
        amount: 30000,
        kind: "deposit",
        status: "planned",
      };
      await rpc("mutate_savings", [deposit]);
      await rpc("mutate_savings", [deposit]);
      let overview = await rpc<Overview>("savings_overview", [month]);
      assert.equal(overview.buffer, 5000);
      assert.equal(overview.goals[0].saved, 0);
      assert.equal(overview.goals[0].planned, 30000);
      await as(bob);
      await rpc("mutate_savings", [{ action: "confirm", goalId, movementId }]);
      await rpc("mutate_savings", [{ action: "confirm", goalId, movementId }]);
      overview = await rpc<Overview>("savings_overview", [month]);
      assert.equal(overview.goals[0].saved, 30000);
      assert.equal(overview.goals[0].savedInMonth, 30000);
      assert.equal(overview.goals[0].planned, 0);
      assert.equal(overview.goals[0].movements.length, 1);
      assert.ok(overview.goals[0].movements[0].actor.startsWith("Alice"));
      const withdrawal = {
        action: "movement",
        goalId,
        movementId: withdrawId,
        amount: 10000,
        kind: "withdraw",
        status: "saved",
      };
      await assert.rejects(
        () => rpc("mutate_savings", [{ ...withdrawal, amount: 40000 }]),
        /insufficient_savings/,
      );
      await rpc("mutate_savings", [withdrawal]);
      overview = await rpc<Overview>("savings_overview", [month]);
      assert.equal(overview.goals[0].saved, 20000);
      assert.equal(overview.goals[0].savedInMonth, 20000);
      await as(outsider);
      assert.equal(
        (await rpc<Overview>("savings_overview", [month])).goals.length,
        0,
      );
      await assert.rejects(
        () => rpc("mutate_savings", [deposit]),
        /goal_not_found/,
      );
      await assert.rejects(
        () =>
          rpc("mutate_savings", [
            {
              action: "goal",
              goalId,
              name: "Outra",
              target: 1,
              deadline: "2030-01-01",
              priority: 1,
            },
          ]),
        /goal_not_found/,
      );
      await as("", "anon");
      await assert.rejects(() => rpc("savings_overview", [month]));
    },
  );
  await t.test(
    "recurring income clips dates, stays receivable, versions amounts and stops without rewriting history",
    async () => {
      await as(alice);
      const payload = {
        ...base,
        kind: "income",
        description: "Salário recorrente",
        category: "Salário",
        date: "2032-01-31",
        amount: 250000,
        confirmed: true,
      };
      const initial = await rpc<{
        id: string;
        kind: string;
        confirmed: boolean;
        payer: null;
      }>("add_entry", [payload]);
      assert.equal(initial.kind, "income");
      assert.equal(initial.confirmed, true);
      assert.equal(initial.payer, null);
      const rule = initial.id.split(":")[0];
      const feb = initial.id.replace("2032-01", "2032-02");
      const march = initial.id.replace("2032-01", "2032-03");
      const april = initial.id.replace("2032-01", "2032-04");
      await rpc("sync_month", ["2032-02-01"]);
      await rpc("sync_month", ["2032-02-01"]);
      assert.deepEqual(
        (
          await db.query(
            "select kind,date::text,confirmed,payer,confirmed_at from nc_entries where id=$1",
            [feb],
          )
        ).rows,
        [
          {
            kind: "income",
            date: "2032-02-29",
            confirmed: false,
            payer: null,
            confirmed_at: null,
          },
        ],
      );
      assert.deepEqual(
        (
          await db.query("select kind from nc_recurring_rules where id=$1", [
            rule,
          ])
        ).rows,
        [{ kind: "income" }],
      );
      await rpc("confirm_entry", [feb, true, "Alice"]);
      await rpc("sync_month", ["2032-02-01"]);
      assert.deepEqual(
        (
          await db.query("select confirmed,payer from nc_entries where id=$1", [
            feb,
          ])
        ).rows,
        [{ confirmed: true, payer: null }],
      );
      await rpc("sync_month", ["2032-03-01"]);
      await rpc("edit_entry", [
        feb,
        { ...payload, date: "2032-02-29", amount: 275000 },
        true,
      ]);
      await rpc("sync_month", ["2032-04-01"]);
      assert.deepEqual(
        (
          await db.query(
            "select amount::integer,confirmed from nc_entries where id=$1",
            [initial.id],
          )
        ).rows,
        [{ amount: 250000, confirmed: true }],
      );
      assert.deepEqual(
        (
          await db.query(
            "select amount::integer,confirmed from nc_entries where id=$1",
            [march],
          )
        ).rows,
        [{ amount: 250000, confirmed: false }],
      );
      assert.deepEqual(
        (
          await db.query(
            "select amount::integer,confirmed from nc_entries where id=$1",
            [april],
          )
        ).rows,
        [{ amount: 275000, confirmed: false }],
      );
      await rpc("delete_entry", [april]);
      await rpc("sync_month", ["2032-04-01"]);
      assert.equal(
        (
          await db.query(
            "select id from nc_entries where id=$1 and deleted_at is null",
            [april],
          )
        ).rows.length,
        0,
      );
      await as(outsider);
      assert.equal(
        (
          await db.query("select id from nc_recurring_rules where id=$1", [
            rule,
          ])
        ).rows.length,
        0,
      );
      await assert.rejects(() => rpc("confirm_entry", [feb, false]));
      await assert.rejects(() =>
        rpc("edit_entry", [feb, { ...payload, date: "2032-02-29" }, true]),
      );
      await assert.rejects(() => rpc("stop_recurring", [feb]));
      await assert.rejects(() => rpc("delete_entry", [feb]));
      await as(bob);
      await rpc("confirm_entry", [march, true]);
      await rpc("stop_recurring", [feb]);
      await rpc("sync_month", ["2032-05-01"]);
      assert.equal(
        (
          await db.query(
            "select id from nc_entries where rule_id=$1 and date>='2032-05-01'",
            [rule],
          )
        ).rows.length,
        0,
      );
      assert.deepEqual(
        (
          await db.query("select confirmed from nc_entries where id=$1", [
            march,
          ])
        ).rows,
        [{ confirmed: true }],
      );
    },
  );
  await t.test(
    "edits a built-in category and preserves its history within one household",
    async () => {
      await as(alice);
      const entry = await rpc<{ id: string }>("add_entry", [
        { ...base, category: "Saúde", date: "2026-07-01" },
      ]);
      await assert.rejects(
        () => rpc("edit_category", ["expense", "Saúde", "Mercado", "leisure"]),
        /category_name_taken/,
      );
      await rpc("edit_category", [
        "expense",
        "Saúde",
        "Saúde e beleza",
        "leisure",
      ]);
      assert.deepEqual(
        (
          await db.query(
            "select default_name,budget_group from nc_categories where name='Saúde e beleza'",
          )
        ).rows,
        [{ default_name: "Saúde", budget_group: "leisure" }],
      );
      assert.deepEqual(
        (
          await db.query("select category from nc_entries where id=$1", [
            entry.id,
          ])
        ).rows,
        [{ category: "Saúde e beleza" }],
      );
      await assert.rejects(
        () =>
          rpc("edit_category", [
            "expense",
            "Saúde",
            "Outra Saúde",
            "essentials",
          ]),
        /category_not_found/,
      );
      const staleForm = await rpc<{ id: string }>("add_entry", [
        { ...base, category: "Saúde", date: "2026-07-05" },
      ]);
      assert.deepEqual(
        (
          await db.query("select category from nc_entries where id=$1", [
            staleForm.id,
          ])
        ).rows,
        [{ category: "Saúde e beleza" }],
      );
      await as(outsider);
      assert.deepEqual(
        (
          await db.query(
            "select default_name from nc_categories where name='Saúde e beleza'",
          )
        ).rows,
        [],
      );
    },
  );
  await t.test(
    "keeps payment method separate from category and versions recurring defaults",
    async () => {
      await as(alice);
      const payload = {
        ...base,
        category: "Contas e serviços",
        date: "2028-01-05",
        paymentMethod: "credit_card",
      };
      const entry = await rpc<{ id: string; payment_method: string }>(
        "add_entry",
        [payload],
      );
      assert.equal(entry.payment_method, "credit_card");
      await rpc("edit_entry", [
        entry.id,
        { ...payload, paymentMethod: "pix" },
        false,
      ]);
      await rpc("sync_month", ["2028-02-01"]);
      const feb = entry.id.replace(/2028-01$/, "2028-02");
      assert.deepEqual(
        (
          await db.query(
            "select category,payment_method,confirmed from nc_entries where id=$1",
            [feb],
          )
        ).rows,
        [
          {
            category: "Contas e serviços",
            payment_method: "credit_card",
            confirmed: false,
          },
        ],
      );
      await rpc("edit_entry", [
        feb,
        { ...payload, date: "2028-02-05", paymentMethod: "cash" },
        true,
      ]);
      await rpc("sync_month", ["2028-03-01"]);
      const mar = entry.id.replace(/2028-01$/, "2028-03");
      await rpc("edit_entry", [
        mar,
        { ...base, category: payload.category, date: "2028-03-05" },
        true,
      ]);
      await rpc("sync_month", ["2028-04-01"]);
      const apr = entry.id.replace(/2028-01$/, "2028-04");
      assert.deepEqual(
        (
          await db.query(
            "select payment_method from nc_entries where id in ($1,$2,$3) order by date",
            [entry.id, mar, apr],
          )
        ).rows,
        [
          { payment_method: "pix" },
          { payment_method: "cash" },
          { payment_method: "cash" },
        ],
      );
      await assert.rejects(() =>
        rpc("add_entry", [{ ...payload, paymentMethod: "invalid" }]),
      );
      const group = "00000000-0000-4000-8000-000000000099";
      await rpc("add_installments", [
        {
          ...payload,
          repeats: false,
          installmentGroup: group,
          installmentCount: 2,
          installmentMode: "total",
        },
      ]);
      assert.deepEqual(
        (
          await db.query(
            "select distinct payment_method from nc_entries where installment_group=$1",
            [group],
          )
        ).rows,
        [{ payment_method: "credit_card" }],
      );
    },
  );
  await t.test(
    "shares selected entry colors only inside the household",
    async () => {
      await as(alice);
      await rpc("save_profile_color", ["Alice Silva", "alice_silva", "violet"]);
      await rpc("save_profile", ["Alice Silva", "alice_silva"]);
      await assert.rejects(() =>
        rpc("save_profile_color", ["Alice Silva", "alice_silva", "invalid"]),
      );
      const row = await rpc<{ id: string }>("add_entry", [
        {
          ...base,
          repeats: false,
          person: "alice_silva",
          payer: "alice",
          confirmed: true,
          date: "2028-06-01",
        },
      ]);
      const period = ["2028-06-01", "2028-07-01"];
      await as(bob);
      const colors = await rpc<Record<string, unknown>>(
        "entry_profile_colors",
        period,
      );
      assert.deepEqual(colors[row.id], {
        person: "violet",
        payer: "violet",
        person_name: "Alice Silva",
        payer_name: "Alice Silva",
        same_person: true,
      });
      const otherPayer = await rpc<{ id: string }>("add_entry", [
        {
          ...base,
          repeats: false,
          person: "alice_silva",
          payer: "bob",
          confirmed: true,
          date: "2028-06-01",
        },
      ]);
      const updated = await rpc<Record<string, { same_person: boolean }>>(
        "entry_profile_colors",
        period,
      );
      assert.equal(updated[otherPayer.id].same_person, false);
      await as(outsider);
      assert.equal(
        (await rpc<Record<string, unknown>>("entry_profile_colors", period))[
          row.id
        ],
        undefined,
      );
      await as(alice);
    },
  );
  await t.test(
    "renaming an income category updates its recurrence without affecting expense categories",
    async () => {
      await as(alice);
      await rpc("add_category", ["income", "Renda recorrente"]);
      await rpc("add_category", ["expense", "Novo salário", "leisure"]);
      const income = await rpc<{ id: string }>("add_entry", [
        {
          ...base,
          kind: "income",
          category: "Renda recorrente",
          date: "2033-01-31",
          confirmed: false,
        },
      ]);
      const expense = await rpc<{ id: string }>("add_entry", [
        {
          ...base,
          category: "Novo salário",
          date: "2033-01-31",
          confirmed: false,
        },
      ]);
      await rpc("add_entry", [
        {
          ...base,
          kind: "income",
          category: "Outra renda",
          date: "2033-01-31",
          confirmed: false,
        },
      ]);
      await assert.rejects(
        () =>
          rpc("rename_category", ["income", "Renda recorrente", "Outra renda"]),
        /category_name_taken/,
      );
      await rpc("rename_category", [
        "income",
        "Renda recorrente",
        "Novo salário",
      ]);
      await rpc("sync_month", ["2033-02-01"]);
      assert.deepEqual(
        (
          await db.query(
            "select kind,category,confirmed from nc_entries where id=$1",
            [income.id.replace("2033-01", "2033-02")],
          )
        ).rows,
        [{ kind: "income", category: "Novo salário", confirmed: false }],
      );
      await rpc("rename_category", [
        "expense",
        "Novo salário",
        "Despesa renomeada",
      ]);
      await rpc("sync_month", ["2033-03-01"]);
      assert.deepEqual(
        (
          await db.query("select kind,category from nc_entries where id=$1", [
            income.id.replace("2033-01", "2033-03"),
          ])
        ).rows,
        [{ kind: "income", category: "Novo salário" }],
      );
      assert.deepEqual(
        (
          await db.query("select kind,category from nc_entries where id=$1", [
            expense.id.replace("2033-01", "2033-03"),
          ])
        ).rows,
        [{ kind: "expense", category: "Despesa renomeada" }],
      );
    },
  );

  await t.test(
    "commercial data stays admin-only; users can only register their own interest",
    async () => {
      await as(alice);
      const hAlice = await rpc<string>("ensure_household");
      await assert.rejects(
        () => db.query("select nc_admin_data()"),
        /admin_required/,
      );
      await assert.rejects(() =>
        db.query("insert into nc_system_admins(user_id) values($1)", [alice]),
      );
      await db.query("select nc_capture_lead($1,$2,$3,$4,$5)", [
        "google",
        "cpc",
        "casal",
        "/financas-para-casal",
        "yearly",
      ]);
      assert.equal((await db.query("select * from nc_leads")).rows.length, 0);
      await as(bob);
      await db.query("select nc_capture_lead() ");
      await assert.rejects(
        () =>
          db.query(
            "select nc_admin_courtesy($1,now()+interval '1 month','forged grant')",
            [hAlice],
          ),
        /admin_required/,
      );
      await as("", "anon");
      await assert.rejects(() => db.query("select nc_capture_lead()"));
      await db.exec("reset role");
      await db.query("insert into nc_system_admins(user_id) values($1)", [
        alice,
      ]);
      await as(alice);
      assert.equal(
        (
          await db.query<{ nc_is_system_admin: boolean }>(
            "select nc_is_system_admin()",
          )
        ).rows[0].nc_is_system_admin,
        true,
      );
      let snapshot = (
        await db.query<{ data: any }>("select nc_admin_data() as data")
      ).rows[0].data;
      assert.equal(snapshot.summary.leads, 2);
      const original = snapshot.leads.find((l: any) => l.user_id === alice);
      assert.equal(original.source, "google");
      assert.equal(original.cycle, "yearly");
      await db.query("select nc_capture_lead('direct','','','/','quarterly')");
      snapshot = (
        await db.query<{ data: any }>("select nc_admin_data() as data")
      ).rows[0].data;
      const updated = snapshot.leads.find((l: any) => l.user_id === alice);
      assert.equal(updated.source, "google");
      assert.equal(updated.cycle, "quarterly");
      assert.equal(snapshot.summary.leads, 2);
      assert.ok(snapshot.users.every((u: any) => !("amount" in u)));
      await db.query(
        "select nc_admin_save_lead(null,'Manual','charlie@example.com','','contacted','Test note','event')",
      );
      await as(charlie);
      await db.query("select nc_capture_lead() ");
      await as(alice);
      snapshot = (
        await db.query<{ data: any }>("select nc_admin_data() as data")
      ).rows[0].data;
      assert.equal(snapshot.summary.leads, 3);
      assert.equal(
        snapshot.leads.find((l: any) => l.email === "charlie@example.com")
          .source,
        "event",
      );
      await db.query(
        "select nc_admin_courtesy($1,now()+interval '1 month','Partner trial')",
        [hAlice],
      );
      await as(outsider);
      assert.equal(
        (await db.query("select * from nc_subscriptions")).rows.length,
        0,
      );
      await as(alice);
      assert.equal(
        (await db.query("select * from nc_subscriptions")).rows.length,
        1,
      );
      await db.query(
        "select nc_admin_courtesy($1,now()-interval '1 day','End trial')",
        [hAlice],
      );
      snapshot = (
        await db.query<{ data: any }>("select nc_admin_data() as data")
      ).rows[0].data;
      assert.equal(snapshot.summary.courtesies, 0);
      assert.equal(snapshot.audit.length, 3);
      await db.exec("reset role");
      await db.query("delete from nc_system_admins where user_id=$1", [alice]);
      await as(alice);
      await assert.rejects(
        () => db.query("select nc_admin_data()"),
        /admin_required/,
      );
    },
  );
  await t.test(
    "sandbox billing is admin-only, token-protected and idempotent",
    async () => {
      await as(outsider);
      await assert.rejects(
        () => rpc("billing_reserve", ["yearly", "card"]),
        /admin_required/,
      );
      await db.exec("reset role");
      await db.query("insert into nc_system_admins(user_id) values($1)", [
        alice,
      ]);
      const token = "test-token-for-billing-not-a-real-secret-123456";
      await db.query(
        "insert into nossa_conta_private.billing_config(token_hash) values(encode(sha256(convert_to($1,'UTF8')),'hex'))",
        [token],
      );
      await as(alice);
      const order = await rpc<any>("billing_reserve", ["yearly", "card"]);
      assert.equal(order.amount, 11990);
      assert.equal(order.environment, "sandbox");
      const reused = await rpc<any>("billing_reserve", ["yearly", "card"]);
      assert.equal(reused.id, order.id);
      assert.equal(reused.reused, true);
      await assert.rejects(
        () => rpc("billing_reserve", ["monthly", "pix"]),
        /checkout_already_pending/,
      );
      await assert.rejects(() =>
        db.query("update nc_billing_orders set status='paid'"),
      );
      await as("", "anon");
      await assert.rejects(() => db.query("select * from nc_billing_orders"));
      await assert.rejects(
        () =>
          rpc("billing_result", [
            "wrong",
            order.id,
            "checkout-test",
            "paid",
            "event-1",
            11990,
          ]),
        /invalid_billing_token/,
      );
      await assert.rejects(
        () =>
          rpc("billing_result", [
            token,
            order.id,
            "checkout-test",
            "paid",
            "event-1",
            1,
          ]),
        /amount_mismatch/,
      );
      await rpc("billing_result", [
        token,
        order.id,
        "checkout-test",
        "pending",
        null,
        11990,
      ]);
      assert.equal(
        await rpc("billing_result", [
          token,
          order.id,
          "checkout-test",
          "paid",
          "event-1",
          11990,
        ]),
        true,
      );
      assert.equal(
        await rpc("billing_result", [
          token,
          order.id,
          "checkout-test",
          "paid",
          "event-1",
          11990,
        ]),
        true,
      );
      await rpc("billing_result", [
        token,
        order.id,
        "checkout-test",
        "pending",
        "event-2",
        11990,
      ]);
      await assert.rejects(
        () =>
          rpc("billing_result", [
            token,
            order.id,
            "other-checkout",
            "paid",
            "event-3",
            11990,
          ]),
        /checkout_mismatch/,
      );
      await as(outsider);
      assert.equal(
        (await db.query("select * from nc_billing_orders")).rows.length,
        0,
      );
      await as(alice);
      assert.equal(
        (
          await db.query<any>(
            "select status from nc_billing_orders where id=$1",
            [order.id],
          )
        ).rows[0].status,
        "paid",
      );
      await db.exec("reset role");
      assert.equal(
        (await db.query("select * from nossa_conta_private.billing_events"))
          .rows.length,
        2,
      );
      assert.equal(
        (
          await db.query(
            "select * from nc_subscriptions where kind<>'courtesy'",
          )
        ).rows.length,
        0,
      );
      await db.query("delete from nc_system_admins where user_id=$1", [alice]);
    },
  );
  await db.close();
});
