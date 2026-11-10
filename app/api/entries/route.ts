import { authenticated, checkOrigin, failure, ApiError } from "@/lib/api";
import {
  entrySchema,
  editSchema,
  monthSchema,
  installmentSchema,
} from "@/lib/validation";
import { upcomingEnd } from "@/lib/finance-reports";
import { dateInSaoPaulo } from "@/lib/finance";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  try {
    const { db } = await authenticated();
    if (new URL(r.url).searchParams.get("due") === "true") {
      const { data, error } = await db
        .from("nc_entries")
        .select(
          "id,kind,description,amount,category,person,date,confirmed,confirmed_at,payer,installment_group,installment_number,installment_count,payment_method",
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
      const today = dateInSaoPaulo();
      const { data, error } = await db
        .from("nc_entries")
        .select(
          "id,kind,description,amount,category,person,date,confirmed,confirmed_at,payer,installment_group,installment_number,installment_count,payment_method",
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
    const [entries, labels] = await Promise.all([
      db
        .from("nc_entries")
        .select(
          "id,kind,description,amount,category,person,date,confirmed,confirmed_at,payer,payer_user_id,installment_group,installment_number,installment_count,payment_method",
        )
        .gte("date", month.data + "-01")
        .lt("date", nextMonth(month.data))
        .is("deleted_at", null)
        .order("date", { ascending: false }),
      db.rpc("nc_payer_labels"),
    ]);
    if (entries.error) throw entries.error;
    if (labels.error) throw labels.error;
    return Response.json(
      entries.data.map((entry) => ({
        ...entry,
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
    const { db } = await authenticated();
    const body = await r.json();
    if (body.action === "sync") {
      const month = monthSchema.safeParse(body.month);
      if (!month.success) throw new ApiError("Mês inválido.", 400);
      const { error } = await db.rpc("nc_sync_month", {
        p_month: month.data + "-01",
      });
      if (error) throw error;
      return Response.json({ ok: true });
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
        throw new ApiError("Não foi possível atualizar a confirmação.", 400);
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
    const { error } = await db.rpc("nc_edit_entry", {
      p_id: parsed.data.id,
      p_entry: parsed.data,
      p_future: parsed.data.future,
    });
    if (error)
      throw new ApiError(
        "Não foi possível editar. Mantenha o mês original do lançamento.",
        400,
      );
    return Response.json({ ok: true });
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
    if (error) throw new ApiError("Lançamento não encontrado.", 404);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
