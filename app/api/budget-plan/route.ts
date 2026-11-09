import { z } from "zod";
import { ApiError, authenticated, checkOrigin, failure } from "@/lib/api";
import { budgetKeys, defaultPlan, type BudgetPlan } from "@/lib/budget-plan";

const percentage = z.number().int().min(0).max(100);
const schema = z.object({
  enabled: z.boolean(),
  shares: z
    .object({
      essentials: percentage,
      future: percentage,
      leisure: percentage,
      development: percentage,
    })
    .refine(
      (shares) => budgetKeys.reduce((sum, key) => sum + shares[key], 0) === 100,
    ),
  categories: z
    .record(
      z.string().min(1).max(60),
      z.enum(["essentials", "future", "leisure", "development"]),
    )
    .refine((categories) => Object.keys(categories).length <= 500),
});

export async function GET() {
  try {
    const { db } = await authenticated();
    const { data, error } = await db
      .from("nc_budget_plan")
      .select("enabled,essentials,future,leisure,development,categories")
      .maybeSingle();
    if (error) throw error;
    const plan: BudgetPlan = data
      ? {
          enabled: data.enabled,
          shares: {
            essentials: data.essentials,
            future: data.future,
            leisure: data.leisure,
            development: data.development,
          },
          categories: data.categories,
        }
      : defaultPlan;
    return Response.json(plan, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      throw new ApiError(
        "Confira os percentuais e as categorias do plano.",
        400,
      );
    const { data: household, error: householdError } = await db
      .from("nc_households")
      .select("id")
      .maybeSingle();
    if (householdError) throw householdError;
    if (!household)
      throw new ApiError("Abra o espaço da família para salvar o plano.", 403);
    const { enabled, shares, categories } = parsed.data;
    const { error } = await db
      .from("nc_budget_plan")
      .upsert({ household_id: household.id, enabled, ...shares, categories });
    if (error) throw error;
    return Response.json(parsed.data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
