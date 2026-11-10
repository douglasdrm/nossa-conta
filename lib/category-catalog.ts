import type { SupabaseClient } from "@supabase/supabase-js";
import {
  expenseCategories,
  incomeCategories,
  type CategoryItem,
} from "./categories";
import { budgetGroup } from "./budget-plan";
import { colorCategories } from "./category-colors";

export async function categoryCatalog(
  db: SupabaseClient,
): Promise<CategoryItem[]> {
  const [saved, plan] = await Promise.all([
    db
      .from("nc_categories")
      .select("id,kind,name,default_name,budget_group")
      .order("name"),
    db.from("nc_budget_plan").select("categories").maybeSingle(),
  ]);
  if (saved.error) throw saved.error;
  if (plan.error) throw plan.error;
  const overrides = plan.data?.categories ?? {};
  const categories: (Omit<CategoryItem, "color"> & {
    colorIdentity: string;
  })[] = [];
  for (const kind of ["expense", "income"] as const) {
    const defaults = kind === "expense" ? expenseCategories : incomeCategories;
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
        colorIdentity: row?.default_name ?? name,
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
        colorIdentity: "custom:" + row.id,
        group:
          kind === "expense"
            ? ((Object.hasOwn(overrides, row.name)
                ? overrides[row.name]
                : row.budget_group) ?? null)
            : null,
      });
    }
  }

  return colorCategories(categories);
}
