import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expenseCategories, incomeCategories } from "../lib/categories";
import { categoryColor, colorCategories } from "../lib/category-colors";
import { categoryCatalog } from "../lib/category-catalog";

test("all default and 500 custom categories have distinct deterministic colors", () => {
  const names = [...expenseCategories, ...incomeCategories];
  const items = [
    ...names.map((name) => ({
      kind: "expense" as const,
      name,
      group: null,
      colorIdentity: name,
    })),
    ...Array.from({ length: 500 }, (_, index) => ({
      kind: "expense" as const,
      name: "Categoria " + index,
      group: null,
      colorIdentity: "custom:" + index,
    })),
  ];
  const colors = colorCategories(items);
  assert.equal(new Set(colors.map((item) => item.color)).size, items.length);
  assert.ok(colors.every((item) => /^#[a-f0-9]{6}$/.test(item.color)));
  assert.deepEqual(colorCategories([...items].reverse()).reverse(), colors);
  assert.equal(categoryColor("Mercado"), colors[0].color);
});

test("catalog preserves colors after renaming both defaults and custom categories", async () => {
  let rows = [
    {
      id: "id-custom",
      kind: "expense",
      name: "Pets",
      default_name: null,
      budget_group: "essentials",
    },
    {
      id: "id-default",
      kind: "expense",
      name: "Supermercado",
      default_name: "Mercado",
      budget_group: "essentials",
    },
    {
      id: "id-income",
      kind: "income",
      name: "Pets",
      default_name: null,
      budget_group: null,
    },
  ];
  const db = {
    from(table: string) {
      return {
        select() {
          return this;
        },
        order() {
          return Promise.resolve({ data: rows, error: null });
        },
        maybeSingle() {
          assert.equal(table, "nc_budget_plan");
          return Promise.resolve({
            data: { categories: { Pets: "leisure" } },
            error: null,
          });
        },
      };
    },
  } as unknown as SupabaseClient;
  const before = await categoryCatalog(db);
  assert.equal(
    before.find((item) => item.name === "Supermercado")?.color,
    categoryColor("Mercado"),
  );
  assert.equal(
    before.some((item) => item.name === "Mercado"),
    false,
  );
  assert.equal(
    before.find((item) => item.name === "Pets" && item.kind === "expense")
      ?.group,
    "leisure",
  );
  assert.equal(
    before.find((item) => item.name === "Pets" && item.kind === "income")
      ?.group,
    null,
  );
  assert.notEqual(
    before.find((item) => item.name === "Pets" && item.kind === "income")
      ?.color,
    before.find((item) => item.name === "Pets" && item.kind === "expense")
      ?.color,
  );
  rows = rows.map((row) =>
    row.id === "id-custom"
      ? { ...row, name: "Veterinário" }
      : row.id === "id-default"
        ? { ...row, name: "Feira" }
        : row,
  );
  const after = await categoryCatalog(db);
  assert.equal(
    after.find((item) => item.name === "Feira")?.color,
    before.find((item) => item.name === "Supermercado")?.color,
  );
  assert.equal(
    after.find((item) => item.name === "Veterinário")?.color,
    before.find((item) => item.name === "Pets" && item.kind === "expense")
      ?.color,
  );
});
