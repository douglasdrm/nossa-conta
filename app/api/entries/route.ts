import { authenticatedFinance as authenticated, checkOrigin, failure, ApiError } from "@/lib/api";
import {
  entrySchema,
  editSchema,
  monthSchema,
  installmentSchema,
} from "@/lib/validation";
import { cardErrorMessage } from "@/lib/credit-cards";
import { upcomingEnd } from "@/lib/finance-reports";
import { dateInSaoPaulo } from "@/lib/finance";
export const dynamic = "force-dynamic";
async function cardMetadata<T extends { credit_card_id?: string | null; rule_id?: string | null }>(db: Awaited<ReturnType<typeof authenticated>>["db"], entries: T[]) {
  const cardIds = [...new Set(entries.map((e) => e.credit_card_id).filter((id): id is string => Boolean(id)))];
  const ruleIds = [...new Set(entries.map((e) => e.rule_id).filter((id): id is string => Boolean(id)))];
  const [cards, rules] = await Promise.all([
    cardIds.length ? db.from("nc_credit_cards").select("id,name").in("id", cardIds) : { data: [], error: null },
    ruleIds.length ? db.from("nc_recurring_rules").select("id,credit_card_id").in("id", ruleIds) : { data: [], error: null },
  ]);
  if (cards.error || rules.error) throw new ApiError("Não foi possível consultar os cartões dos lançamentos.", 503);
  return entries.map((e) => ({ ...e, credit_card_name: cards.data?.find((c) => c.id === e.credit_card_id)?.name ?? null, rule_card_id: rules.data?.find((r) => r.id === e.rule_id)?.credit_card_id ?? null }));
}
export async function GET(r: Request) {
  try {
    const { db, access } = await authenticated();
    const entryId = new URL(r.url).searchParams.get("id");
    if (entryId) {
      if (entryId.length > 100) throw new ApiError("Lançamento inválido.", 400);
      const { data, error } = await db.from("nc_entries").select("id,kind,description,amount,category,person,date,confirmed,confirmed_at,payer,payer_user_id,installment_group,installment_number,installment_count,payment_method,credit_card_id,card_invoice_id,purchase_date,rule_id,expense_type,recurrence_interval").eq("id", entryId).is("deleted_at", null);
      if (error) throw error;
      return Response.json(await cardMetadata(db, data), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (new URL(r.url).searchParams.get("due") === "true") {
      const { data, error } = await db
        .from("nc_entries")
        .select(
          "id,kind,description,amount,category,person,date,confirmed,confirmed_at,payer,installment_group,installment_number,installment_count,payment_method,credit_card_id,card_invoice_id,purchase_date,rule_id,expense_type,recurrence_interval",
        )
        .eq("kind", "expense")
        .eq("confirmed", false)
        .is("deleted_at", null)
        .lte("date", dateInSaoPaulo())
        .order("date");
      if (error) throw error;
      return Response.json(data, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (new URL(r.url).searchParams.get("upcoming") === "true") {
      if (!access.premium) throw new ApiError("A previsão de próximos compromissos faz parte do Premium.", 403);
      const today = dateInSaoPaulo();
      const { data, error } = await db
        .from("nc_entries")
        .select(
          "id,kind,description,amount,category,person,date,confirmed,confirmed_at,payer,installment_group,installment_number,installment_count,payment_method,credit_card_id,card_invoice_id,purchase_date,rule_id,expense_type,recurrence_interval",
        )
        .eq("confirmed", false)
        .is("deleted_at", null)
        .gte("date", today)
        .lte("date", upcomingEnd(today))
        .order("date")
        .order("id");
      if (error) throw error;
      return Response.json(data, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const month = monthSchema.safeParse(
      new URL(r.url).searchParams.get("month"),
    );
    if (!month.success) throw new ApiError("Selecione um mês válido.", 400);
    const [entries, labels, colors] = await Promise.all([
      db
        .from("nc_entries")
        .select(
          "id,kind,description,amount,category,person,date,confirmed,confirmed_at,payer,payer_user_id,installment_group,installment_number,installment_count,payment_method,credit_card_id,card_invoice_id,purchase_date,rule_id,expense_type,recurrence_interval",
        )
        .gte("date", month.data + "-01")
        .lt("date", nextMonth(month.data))
        .is("deleted_at", null)
        .order("date", { ascending: false }),
      db.rpc("nc_payer_labels"),
      db.rpc("nc_entry_profile_colors", {
        p_start: month.data + "-01",
        p_end: nextMonth(month.data),
      }),
    ]);
    if (entries.error) throw entries.error;
    if (labels.error) throw labels.error;
    if (colors.error) throw colors.error;
    return Response.json(
      (await cardMetadata(db, entries.data)).map((entry) => ({
        ...entry,
        profile_colors: colors.data?.[entry.id],
        payer_display: entry.payer_user_id
          ? (labels.data?.[entry.payer_user_id] ?? entry.payer)
          : entry.payer,
      })),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
}
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const { db, access } = await authenticated();
    const body = await r.json();
    if (body.action === "sync") {
      if (!access.premium) return Response.json({ ok: true });
      const month = monthSchema.safeParse(body.month);
      if (!month.success) throw new ApiError("Mês inválido.", 400);
      const { error } = await db.rpc("nc_sync_month", {
        p_month: month.data + "-01",
      });
      if (error) throw error;
      return Response.json({ ok: true });
    }
    if (!access.premium && (body.repeats || body.installmentCount !== undefined)) {
      throw new ApiError("Parcelamentos e recorrências fazem parte do Premium.", 403);
    }
    if (body.cardId) {
      const schema = body.installmentCount !== undefined ? installmentSchema : entrySchema;
      const parsed = schema.safeParse(body);
      if (!parsed.success || !parsed.data.purchaseDate || !parsed.data.invoiceMonth) throw new ApiError("Selecione o cartão, a data da compra e a fatura.", 400);
      const { data, error } = await db.rpc(parsed.data.repeats ? "nc_add_entry" : "nc_save_card_purchase", { p_entry: parsed.data });
      if (error) throw new ApiError(cardErrorMessage(error.message), 400);
      return Response.json(data, { status: 201 });
    }
    if (
      body.installmentCount !== undefined ||
      body.installmentMode !== undefined ||
      body.installmentGroup !== undefined
    ) {
      const parsed = installmentSchema.safeParse(body);
      if (!parsed.success)
        throw new ApiError(
          "Confira o valor, a quantidade de parcelas (2 a 120) e a data da primeira parcela.",
          400,
        );
      const { data, error } = await db.rpc("nc_add_installments", {
        p_entry: parsed.data,
      });
      if (error)
        throw new ApiError(
          "Não foi possível salvar o parcelamento. Confira os dados e tente novamente.",
          400,
        );
      return Response.json(data, { status: 201 });
    }
    const parsed = entrySchema.safeParse(
      body.kind === "income" && body.confirmed === undefined
        ? { ...body, confirmed: true }
        : body,
    );
    if (!parsed.success)
      throw new ApiError("Confira os campos do lançamento.", 400);
    const { data, error } = await db.rpc("nc_add_entry", {
      p_entry: parsed.data,
    });
    if (error) throw error;
    return Response.json(data, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(r: Request) {
  try {
    checkOrigin(r);
    const { db } = await authenticated();
    const body = await r.json();
    if (body.action === "confirm") {
      if (
        typeof body.id !== "string" ||
        body.id.length > 100 ||
        typeof body.confirmed !== "boolean"
      )
        throw new ApiError("Lançamento inválido.", 400);
      const { error } = await db.rpc("nc_confirm_entry", {
        p_id: body.id,
        p_confirmed: body.confirmed,
        p_payer:
          typeof body.payer === "string"
            ? body.payer.trim().slice(0, 60)
            : null,
      });
      if (error)
        throw new ApiError(cardErrorMessage(error.message), 400);
      return Response.json({ ok: true });
    }
    if (body.action === "stop") {
      if (typeof body.id !== "string" || body.id.length > 100)
        throw new ApiError("Lançamento inválido.", 400);
      const { error } = await db.rpc("nc_stop_recurring", { p_id: body.id });
      if (error)
        throw new ApiError("Não foi possível encerrar esta recorrência.", 400);
      return Response.json({ ok: true });
    }
    const parsed = editSchema.safeParse(body);
    if (!parsed.success)
      throw new ApiError("Confira os campos do lançamento.", 400);
    if (parsed.data.cardId) {
      if (!parsed.data.purchaseDate || !parsed.data.invoiceMonth) throw new ApiError("Confira a data da compra e a fatura.", 400);
      const { data, error } = await db.rpc("nc_edit_card_recurrence", { p_entry: { ...parsed.data, kind: "expense" }, p_id: parsed.data.id });
      if (error) throw new ApiError(cardErrorMessage(error.message), 400);
      return Response.json(data);
    }
    const { data, error } = await db.rpc("nc_edit_entry_payment", {
      p_id: parsed.data.id,
      p_entry: parsed.data,
      p_future: parsed.data.future,
    });
    if (error)
      throw new ApiError(
        cardErrorMessage(error.message),
        400,
      );
    return Response.json(data);
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(r: Request) {
  try {
    checkOrigin(r);
    const { db } = await authenticated();
    const { id } = await r.json();
    if (typeof id !== "string" || id.length > 100)
      throw new ApiError("Lançamento inválido.", 400);
    const { error } = await db.rpc("nc_delete_entry", { p_id: id });
    if (error) throw new ApiError(cardErrorMessage(error.message), 400);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

