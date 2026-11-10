import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expenseCategories, incomeCategories } from "../lib/categories";
import {
  categoryColor,
  categoryColorAt,
  categoryColorFamilies,
  categoryColorSequence,
  categoryStyle,
  colorCategories,
} from "../lib/category-colors";
import { categoryCatalog } from "../lib/category-catalog";

test("palette keeps three distinct pastel shades of each system color", () => {
  assert.equal(categoryColorSequence.length, 24);
  assert.equal(new Set(categoryColorSequence).size, 24);
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5]
      .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const family of categoryColorFamilies) {
    const [light, medium, dark] = family.shades.map(luminance);
    assert.ok(light - medium > 0.08, family.name + " light/medium");
    assert.ok(medium - dark > 0.08, family.name + " medium/dark");
    for (const shade of family.shades) {
      // Pastel colors stay luminous; dark text must remain readable on every shade.
      assert.ok(luminance(shade) > 0.35, family.name + " pastel");
      assert.ok(
        (luminance(shade) + 0.05) / (luminance("#263d34") + 0.05) >= 4.5,
        family.name + " text contrast",
      );
    }
    assert.equal(
      new Set(
        family.shades.map(
          (shade) =>
            categoryStyle(shade)[
              "--category-surface" as keyof ReturnType<typeof categoryStyle>
            ],
        ),
      ).size,
      3,
    );
  }
});

test("new categories continue the sequence without changing existing colors, including a full cycle", () => {
  const names = [...expenseCategories, ...incomeCategories];
  const defaults = names.map((name) => ({
    kind: "expense" as const,
    name,
    group: null,
    colorIdentity: name,
  }));
  const first = {
    kind: "expense" as const,
    name: "Pets",
    group: null,
    colorIdentity: "custom:z",
    createdAt: "2026-11-01T12:00:00.000Z",
  };
  const old = colorCategories([...defaults, first]);
  // The next UUID sorts before the existing one, but its creation date is later.
  const added = {
    ...first,
    name: "Viagens",
    colorIdentity: "custom:a",
    createdAt: "2026-11-02T12:00:00.000Z",
  };
  const next = colorCategories([...defaults, first, added]);
  assert.deepEqual(next.slice(0, -1), old);
  assert.equal(next.at(-2)?.color, categoryColorAt(names.length));
  assert.equal(next.at(-1)?.color, categoryColorAt(names.length + 1));
  assert.deepEqual(
    colorCategories([...defaults, added, first])
      .slice(-2)
      .reverse(),
    next.slice(-2),
  );
  const renamed = colorCategories([
    ...defaults,
    { ...first, name: "Veterinário" },
    added,
  ]);
  assert.equal(renamed.at(-2)?.color, old.at(-1)?.color);
  assert.equal(categoryColorAt(24), categoryColorAt(0));
  assert.equal(categoryColorAt(25), categoryColorAt(1));
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
