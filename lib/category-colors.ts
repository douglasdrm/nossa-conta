import type { CSSProperties } from "react";
import {
  expenseCategories,
  incomeCategories,
  type CategoryItem,
} from "./categories";

// Three pastel shades for each family from the application's palette.
export const categoryColorFamilies = [
  { name: "Verde", shades: ["#e4eee7", "#bfd6c7", "#94b79f"] },
  { name: "Azul", shades: ["#e5edf8", "#c1d2ed", "#97b1d8"] },
  { name: "Âmbar", shades: ["#fbefd8", "#f0d6a5", "#deba79"] },
  { name: "Rosa", shades: ["#f7e5ed", "#e8bfd0", "#d699b4"] },
  { name: "Lilás", shades: ["#eee7f5", "#d7c5e6", "#b99fce"] },
  { name: "Turquesa", shades: ["#e2f0ef", "#b9d9d7", "#8cbfbc"] },
  { name: "Terracota", shades: ["#f9e8e2", "#edc6b8", "#dca18a"] },
  { name: "Oliva", shades: ["#edf0df", "#d4dcba", "#b3c28f"] },
] as const;
// Alternate families and contrast levels so adjacent categories are easy to distinguish.
export const categoryColorSequence = [0, 1, 2].flatMap((round) =>
  categoryColorFamilies.map(
    (family, index) => family.shades[(index + round) % 3],
  ),
);
const defaults = [...expenseCategories, ...incomeCategories];
export const categoryColorAt = (index: number) =>
  categoryColorSequence[index % categoryColorSequence.length];

export function categoryColor(identity: string): string {
  const index = defaults.indexOf(identity);
  // Legacy category names outside the catalog receive a stable fallback from the same palette.
  if (index >= 0) return categoryColorAt(index);
  let hash = 0;
  for (const character of identity.normalize("NFC"))
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return categoryColorAt(hash);
}

type CatalogColorInput = Omit<CategoryItem, "color"> & {
  colorIdentity: string;
  createdAt?: string;
};
export function colorCategories(items: CatalogColorInput[]): CategoryItem[] {
  const custom = items
    .filter((item) => !defaults.includes(item.colorIdentity))
    .sort(
      (a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.colorIdentity.localeCompare(b.colorIdentity),
    );
  const assigned = new Map(
    custom.map((item, index) => [
      item.colorIdentity,
      categoryColorAt(defaults.length + index),
    ]),
  );
  return items.map(({ colorIdentity, createdAt, ...item }) => ({
    ...item,
    color: assigned.get(colorIdentity) ?? categoryColor(colorIdentity),
  }));
}

export function categoryStyle(color: string): CSSProperties {
  return {
    "--badge-color": color,
    "--category-text": "#263d34",
    "--category-contrast": "#263d34",
    "--category-surface": `color-mix(in srgb, ${color} 60%, #fff)`,
  } as CSSProperties;
}
