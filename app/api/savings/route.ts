import { z } from "zod";
import { ApiError, authenticated, checkOrigin, failure } from "@/lib/api";
import { dateSchema, monthSchema } from "@/lib/validation";
export const dynamic = "force-dynamic";

const cents = z.number().int().min(0).max(1_000_000_000);
const uuid = z.string().uuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("buffer"), amount: cents }),
  z.object({
    action: z.literal("goal"),
    goalId: uuid,
    name: z.string().trim().min(1).max(80),
    target: cents.min(1),
    deadline: dateSchema,
    priority: z.number().int().min(1).max(999),
  }),
  z.object({
    action: z.literal("movement"),
    goalId: uuid,
    movementId: uuid,
    amount: cents.min(1),
    kind: z.enum(["deposit", "withdraw"]),
    status: z.enum(["planned", "saved"]),
  }),
  z.object({ action: z.literal("confirm"), goalId: uuid, movementId: uuid }),
  z.object({ action: z.literal("cancel"), goalId: uuid, movementId: uuid }),
]);

export async function GET(request: Request) {
  try {
    const { db } = await authenticated();
    const month = monthSchema.safeParse(
      new URL(request.url).searchParams.get("month"),
    );
    if (!month.success) throw new ApiError("Selecione um mês válido.", 400);
    const { data, error } = await db.rpc("nc_savings_overview", {
      p_month: month.data + "-01",
    });
    if (error) throw error;
    return Response.json(data ?? { buffer: 0, goals: [] }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new ApiError("Confira os dados da caixinha.", 400);
    const { error } = await db.rpc("nc_mutate_savings", {
      p_action: parsed.data,
    });
    if (error?.message === "insufficient_savings")
      throw new ApiError("A retirada é maior que o valor guardado.", 409);
    if (error?.message === "movement_already_processed")
      throw new ApiError(
        "Esse valor já foi atualizado. Recarregue as caixinhas.",
        409,
      );
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
