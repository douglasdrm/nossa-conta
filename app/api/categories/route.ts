import { authenticated, checkOrigin, failure, ApiError } from "@/lib/api";
import {
  expenseCategories,
  incomeCategories,
  type CategoryItem,
} from "@/lib/categories";
import { budgetGroup } from "@/lib/budget-plan";
import { z } from "zod";
export const dynamic = "force-dynamic";
const group = z.enum(["essentials", "future", "leisure", "development"]);
const categorySchema = z
  .object({
    kind: z.enum(["income", "expense"]),
    name: z.string().trim().min(1).max(60),
    group: group.nullish(),
  })
  .refine(({ kind, group }) => (kind === "expense" ? Boolean(group) : !group));
export async function GET() {
  try {
    const { db } = await authenticated();
    const [saved, plan] = await Promise.all([
      db
        .from("nc_categories")
        .select("kind,name,default_name,budget_group")
        .order("name"),
      db.from("nc_budget_plan").select("categories").maybeSingle(),
    ]);
    if (saved.error) throw saved.error;
    if (plan.error) throw plan.error;
    const overrides = plan.data?.categories ?? {};
    const categories: CategoryItem[] = [];
    for (const kind of ["expense", "income"] as const) {
      const defaults =
        kind === "expense" ? expenseCategories : incomeCategories;
      const rows = saved.data.filter((item) => item.kind === kind);
      for (const name of defaults) {
        const row = rows.find(
          (item) =>
            item.default_name === name ||
            (!item.default_name && item.name === name),
        );
        const label = row?.name ?? name;
        categories.push({
          kind,
          name: label,
          group:
            kind === "expense"
              ? ((Object.hasOwn(overrides, label)
                  ? overrides[label]
                  : (row?.budget_group ?? budgetGroup(label, {}))) ?? null)
              : null,
        });
      }
      for (const row of rows) {
        if (row.default_name || defaults.includes(row.name)) continue;
        categories.push({
          kind,
          name: row.name,
          group:
            kind === "expense"
              ? ((Object.hasOwn(overrides, row.name)
                  ? overrides[row.name]
                  : row.budget_group) ?? null)
              : null,
        });
      }
    }
    return Response.json(categories, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const { db } = await authenticated();
    const parsed = categorySchema.safeParse(await r.json());
    if (!parsed.success)
      throw new ApiError(
        "Informe um nome de até 60 caracteres e escolha o grupo financeiro para despesas.",
        400,
      );
    const { data, error } = await db.rpc("nc_add_category", {
      p_kind: parsed.data.kind,
      p_name: parsed.data.name,
      p_budget_group: parsed.data.group ?? null,
    });
    if (error)
      throw new ApiError(
        "Não foi possível criar a categoria. Tente novamente.",
        400,
      );
    return Response.json(data, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

const renameSchema = z.object({
  kind: z.enum(["income", "expense"]),
  oldName: z.string().trim().min(1).max(60),
  group: group.nullish(),
  name: z.string().trim().min(1).max(60),
});

export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const parsed = renameSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError("Informe um nome de até 60 caracteres.", 400);
    const { kind, oldName, name, group: budget } = parsed.data;
    if (kind === "income" && budget)
      throw new ApiError("Grupos financeiros são usados para despesas.", 400);
    const { data, error } = await db.rpc("nc_edit_category", {
      p_kind: kind,
      p_old_name: oldName,
      p_name: name,
      p_budget_group: budget ?? null,
    });
    if (error?.message === "category_name_taken" || error?.code === "23505")
      throw new ApiError("Já existe uma categoria com esse nome.", 409);
    if (error?.message === "category_not_found")
      throw new ApiError(
        "A categoria foi alterada. Reabra o lançamento e tente novamente.",
        409,
      );
    if (error) throw error;
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
