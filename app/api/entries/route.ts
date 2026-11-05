import { authenticated, checkOrigin, failure, ApiError } from "@/lib/api";
import { entrySchema, editSchema, monthSchema } from "@/lib/validation";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  try {
    const { db } = await authenticated();
    const month = monthSchema.safeParse(
      new URL(r.url).searchParams.get("month"),
    );
    if (!month.success) throw new ApiError("Selecione um mês válido.", 400);
    const { data, error } = await db
      .from("nc_entries")
      .select("id,kind,description,amount,category,person,date")
      .gte("date", month.data + "-01")
      .lt("date", nextMonth(month.data))
      .is("deleted_at", null)
      .order("date", { ascending: false });
    if (error) throw error;
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
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
    const parsed = entrySchema.safeParse(body);
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
