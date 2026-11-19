import { z } from "zod";
import { authenticatedFinance, checkOrigin, failure, ApiError } from "@/lib/api";
import { creditCardSchema, cardErrorMessage } from "@/lib/credit-cards";
import { dateSchema } from "@/lib/validation";
export const dynamic = "force-dynamic";
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await page(from, from + 499);
    if (result.error || !result.data) throw new ApiError("Não foi possível carregar os cartões e faturas.", 503);
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
}
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedFinance();
    const catalogOnly = new URL(request.url).searchParams.get("catalog") === "true";
    let blockedCharges = 0;
    if (!catalogOnly) {
      const sync = await db.rpc("nc_sync_card_forecast");
      if (sync.error) throw new ApiError("Não foi possível atualizar as cobranças previstas.", 503);
      blockedCharges = Number(sync.data) || 0;
    }
    const [cards, invoices, entries] = await Promise.all([
      allRows((from, to) => db.from("nc_credit_cards").select("id,name,closing_day,due_day,closing_estimated,archived").order("created_at").order("id").range(from, to)),
      catalogOnly ? [] : allRows((from, to) => db.from("nc_card_invoices").select("id,card_id,invoice_month,due_date,paid_at,payer").order("invoice_month", { ascending: false }).order("id").range(from, to)),
      catalogOnly ? [] : allRows((from, to) => db.from("nc_entries").select("id,description,amount,category,person,credit_card_id,card_invoice_id,purchase_date,date,confirmed,installment_number,installment_count,rule_id,expense_type,recurrence_interval").not("card_invoice_id", "is", null).is("deleted_at", null).order("date").order("id").range(from, to)),
    ]);
    return Response.json({ cards, invoices, entries, blockedCharges }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await authenticatedFinance();
    const input = creditCardSchema.safeParse(await request.json());
    if (!input.success) throw new ApiError("Informe o nome e dias de fechamento e vencimento entre 1 e 31.", 400);
    const { data, error } = await db.rpc("nc_save_credit_card", { p_card: input.data });
    if (error) throw new ApiError(cardErrorMessage(error.message), 400);
    return Response.json(data, { status: 201 });
  } catch (error) { return failure(error); }
}
const invoiceAction = z.discriminatedUnion("action", [
  z.object({ id: z.string().uuid(), action: z.literal("pay"), payer: z.string().trim().min(1).max(60) }),
  z.object({ id: z.string().uuid(), action: z.literal("reopen") }),
  z.object({ id: z.string().uuid(), action: z.literal("due"), dueDate: dateSchema }),
]);
export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await authenticatedFinance();
    const input = invoiceAction.safeParse(await request.json());
    if (!input.success) throw new ApiError("Confira os dados da fatura.", 400);
    const p = input.data;
    const { error } = await db.rpc("nc_update_card_invoice", { p_id: p.id, p_action: p.action, p_due: p.action === "due" ? p.dueDate : null, p_payer: p.action === "pay" ? p.payer : null });
    if (error) throw new ApiError(cardErrorMessage(error.message), 400);
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
