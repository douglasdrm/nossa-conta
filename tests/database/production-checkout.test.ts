import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { restrictedProductionInboxAdapter } from "../../lib/production-inbox-adapter";
import { createProductionWebhookHandler } from "../../lib/production-webhook-handler";
import { processProductionPayment } from "../../lib/production-payment-worker";

test("checkout and webhook reconcile payment, retry, renewal and refund without bypassing household permissions", async () => {
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
      "20261116193000_production_inbox_executor_role.sql",
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
    const memberAccess = await db.query<{ valid_until: string | null }>("select public.nc_production_paid_premium_until() as valid_until");
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
    await assert.rejects(db.query("select * from nossa_conta_private.nc_production_checkout_orders"), /permission denied/);
    await db.exec("reset role");
    const firstDue = (await db.query<{ today: string }>(
      "select (now() at time zone 'America/Sao_Paulo')::date::text as today",
    )).rows[0].today;
    const providerCard = {
      id: "pay_card01", dueDate: firstDue, status: "CONFIRMED", value: 14.9,
      checkoutSession: "checkout_card01", subscription: "sub_fixture01", billingType: "CREDIT_CARD",
    };
    type Payment = Omit<typeof providerCard, "checkoutSession"> & { checkoutSession: string | null };
    const provider = new Map<string, Payment>([[providerCard.id, providerCard]]);
    let outage = false;
    const send: typeof fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.asaas.com");
      if (outage) return new Response(null, { status: 503 });
      if (url.pathname === "/v3/payments") return Response.json({
        data: [...provider.values()].filter((row) => row.checkoutSession === url.searchParams.get("checkoutSession")),
        hasMore: false,
      });
      if (url.pathname === "/v3/subscriptions/sub_fixture01") return Response.json({
        id: providerCard.subscription, cycle: "MONTHLY", status: "ACTIVE",
        value: 14.9, billingType: "CREDIT_CARD",
      });
      const row = provider.get(url.pathname.replace("/v3/payments/", ""));
      return row ? Response.json(row) : new Response(null, { status: 404 });
    };
    const store = {
      async claim() {
        return (await db.query<{ result: unknown }>(
          "select nossa_conta_private.payment_worker_claim() as result",
        )).rows[0].result;
      },
      async context(event: string, attempt: number, checkout: string | null, reference: string | null, subscription: string | null) {
        return (await db.query<{ result: unknown }>(
          "select nossa_conta_private.payment_worker_context($1,$2,$3,$4,$5) as result",
          [event, attempt, checkout, reference, subscription],
        )).rows[0].result;
      },
      async finish(event: string, attempt: number, decision: string, evidence: object | null) {
        return (await db.query<{ result: string }>(
          "select nossa_conta_private.payment_worker_finish($1,$2,$3,$4::jsonb) as result",
          [event, attempt, decision, evidence ? JSON.stringify(evidence) : null],
        )).rows[0].result;
      },
    };
    const runWorker = async () => {
      await db.exec("set role nc_production_payment_worker");
      try {
        return await processProductionPayment(store, "test-only-asaas-key", send);
      } finally {
        await db.exec("reset role");
      }
    };
    let wakes = 0;
    const hook = createProductionWebhookHandler({
      enabled: true,
      webhookSecret: () => token,
      persist: restrictedProductionInboxAdapter(async (sql, values) => {
        await db.exec("set role nc_production_inbox_executor");
        try {
          return (await db.query<{ outcome: unknown }>(sql, [...values])).rows;
        } finally {
          await db.exec("reset role");
        }
      }),
      onAcknowledged: () => { wakes++; },
    });
    const deliver = (id: string, event: string, paymentId: string, secret = token) => hook(new Request("https://example.test/asaas", {
      method: "POST",
      headers: { "asaas-access-token": secret },
      body: JSON.stringify({ id, event, payment: { id: paymentId } }),
    }));
    assert.equal((await deliver("evt_card01", "PAYMENT_CONFIRMED", providerCard.id, "wrong")).status, 401);
    assert.equal(wakes, 0);
    assert.equal((await deliver("evt_card01", "PAYMENT_CONFIRMED", providerCard.id)).status, 200);
    assert.equal(wakes, 1);
    assert.equal(await runWorker(), "processed");
    assert.equal((await deliver("evt_card01", "PAYMENT_CONFIRMED", providerCard.id)).status, 200);
    assert.equal(await runWorker(), "empty");
    const binding = (await db.query<{ next_due_date: string }>(
      "select next_due_date::text from nossa_conta_private.nc_production_subscription_links where status='active'",
    )).rows[0];
    assert.ok(binding.next_due_date);
    const renewal = {
      ...providerCard, id: "pay_renewal01", checkoutSession: null, dueDate: binding.next_due_date, status: "RECEIVED",
    };
    provider.set(renewal.id, renewal);
    assert.equal((await deliver("evt_renewal01", "PAYMENT_RECEIVED", renewal.id)).status, 200);
    outage = true;
    assert.equal(await runWorker(), "retry");
    outage = false;
    assert.equal(await runWorker(), "empty");
    await db.exec("update nossa_conta_private.nc_production_event_inbox set available_at=now() where event_id='evt_renewal01'");
    assert.equal(await runWorker(), "processed");
    assert.equal((await db.query("select 1 from nossa_conta_private.nc_production_charges")).rows.length, 3);

    await db.exec("set role nc_production_payment_worker");
    await assert.rejects(db.query("select * from nossa_conta_private.nc_production_charges"), /permission denied/);
    await db.exec("reset role");
    for (const row of [providerCard, renewal]) {
      provider.set(row.id, { ...row, status: "REFUNDED" });
      assert.equal((await deliver("evt_refund_" + row.id, "PAYMENT_REFUNDED", row.id)).status, 200);
      assert.equal(await runWorker(), "processed");
    }
    assert.equal((await db.query("select 1 from nossa_conta_private.nc_production_charges where status='REFUNDED'")).rows.length, 2);

    await as(owner);
    assert.equal((await db.query<{ valid_until: string | null }>(
      "select public.nc_production_paid_premium_until() as valid_until",
    )).rows[0].valid_until, null);
    if (process.env.NC_RUN_ASAAS_SANDBOX === "1") {
      const key = process.env.NC_ASAAS_SANDBOX_API_KEY;
      const checkout = process.env.NC_ASAAS_SANDBOX_CHECKOUT_ID;
      assert.equal(process.env.VERCEL_ENV, "preview");
      assert.equal(process.env.VERCEL_GIT_COMMIT_REF, "test/asaas-sandbox-live");
      if (!key || !checkout || !/^[A-Za-z0-9_-]{10,100}$/.test(checkout)) {
        throw new Error("Configure the Sandbox key and a valid checkout ID together");
      }

      const sandboxFetch: typeof fetch = async (input, options) => {
        const route = new URL(String(input));
        if (route.origin !== "https://api.asaas.com" || !route.pathname.startsWith("/v3/") ||
            (options?.method && options.method !== "GET")) {
          throw new Error("Sandbox fixture permits only Asaas v3 lookup requests");
        }
        const target = "https://api-sandbox.asaas.com" + route.pathname + route.search;
        return fetch(target, { ...options, method: "GET", redirect: "error",
          signal: AbortSignal.timeout(12000) });
      };

      const listing = await sandboxFetch("https://api.asaas.com/v3/payments?limit=20&checkoutSession=" +
        encodeURIComponent(checkout), { headers: { access_token: key, "User-Agent": "NossaConta/SandboxPreview" } });
      if (!listing.ok) throw new Error("Asaas Sandbox payment lookup failed (HTTP " + listing.status + ")");
      const records = await listing.json() as { data?: Array<{
        id?: string; dueDate?: string; status?: string; billingType?: string; value?: number;
      }>; hasMore?: boolean };
      const matches = records.data?.filter((item) =>
        (item.billingType === "PIX" && item.status === "RECEIVED") ||
        (item.billingType === "CREDIT_CARD" && ["CONFIRMED", "RECEIVED"].includes(item.status ?? ""))
      ) ?? [];
      if (records.hasMore || matches.length !== 1) {
        throw new Error("Use a Sandbox checkout with exactly one settled first payment");
      }
      const payment = matches[0];
      if (typeof payment.id !== "string" || !/^pay_[A-Za-z0-9_-]{3,120}$/.test(payment.id) ||
          typeof payment.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate) ||
          payment.value !== 14.9) {
        throw new Error("Use a settled Sandbox checkout for Premium Mensal (R$ 14,90)");
      }
      const sandboxOwner = "10000000-0000-4000-8000-000000000003";
      const sandboxHousehold = "20000000-0000-4000-8000-000000000002";
      await db.exec("reset role");
      await db.query("insert into auth.users values ($1,now(),false)", [sandboxOwner]);
      await db.query("insert into public.nc_households values ($1,$2)", [sandboxHousehold,sandboxOwner]);
      await db.query("insert into public.nc_household_members values ($1,$2)", [sandboxHousehold,sandboxOwner]);
      await as(sandboxOwner);
      const method = payment.billingType === "PIX" ? "pix" : "card";
      const sandboxOrder = await reserve(token, method);
      if (sandboxOrder.status !== "ready") throw new Error("Sandbox test order reservation failed");
      const saved = await db.query<{ result: boolean }>(
        "select public.nc_attach_production_checkout($1,$2,$3) as result", [token,sandboxOrder.id,checkout]);
      assert.equal(saved.rows[0].result, true);
      await db.exec("reset role");
      // Align the disposable order with the date of the existing test payment.
      await db.query("update nossa_conta_private.nc_production_checkout_orders set created_at=$1::date::timestamp at time zone 'America/Sao_Paulo' where id=$2",
        [payment.dueDate, sandboxOrder.id]);
      const response = await deliver("evt_live_sandbox", payment.status === "RECEIVED" ? "PAYMENT_RECEIVED" : "PAYMENT_CONFIRMED", payment.id);
      assert.equal(response.status, 200);
      await db.exec("set role nc_production_payment_worker");
      try {
        // Do not print provider payloads or identifiers in build logs.
        const processed = await processProductionPayment(store, key, sandboxFetch);
        if (processed !== "processed") throw new Error("Sandbox reconciliation returned " + processed);
      } finally {
        await db.exec("reset role");
      }
      const recorded = await db.query<{ ok: boolean }>(
        "select exists(select 1 from nossa_conta_private.nc_production_charges where provider_payment_id=$1 and household_id=$2 and provider_verified_at is not null) as ok",
        [payment.id,sandboxHousehold]);
      assert.equal(recorded.rows[0].ok, true, "Sandbox charge was not recorded");
      console.log("NC_ASAAS_SANDBOX: provider lookup and durable reconciliation verified");
    }
  } finally {
    await db.close();
  }
});
