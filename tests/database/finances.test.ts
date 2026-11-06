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
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
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
    "all tables enable RLS and public RPCs are invoker functions",
    async () => {
      await db.exec("reset role");
      const tables = (
        await db.query<{ relname: string; relrowsecurity: boolean }>(
          "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'nc_%'",
        )
      ).rows;
      assert.equal(tables.length, 8);
      assert.ok(tables.every((t) => t.relrowsecurity));
      const unsafe = (
        await db.query(
          "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.proname like 'nc_%'",
        )
      ).rows;
      assert.equal(unsafe.length, 0);
    },
  );
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
      assert.equal(income.confirmed, true);
      await assert.rejects(() => rpc("confirm_entry", [income.id, false]));
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
  await db.close();
});
