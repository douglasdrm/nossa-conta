import type { CSSProperties } from "react";
import {
  expenseCategories,
  incomeCategories,
  type CategoryItem,
} from "./categories";

// Three deliberate shades for each family from the application's palette.
export const categoryColorFamilies = [
  { name: "Verde", shades: ["#8db7a1", "#397254", "#1e493c"] },
  { name: "Azul", shades: ["#9bb2d9", "#5473ac", "#31496f"] },
  { name: "Âmbar", shades: ["#e6bf7b", "#b4792f", "#704a20"] },
  { name: "Rosa", shades: ["#d7a4b9", "#b7557c", "#72364f"] },
  { name: "Lilás", shades: ["#b7a4cf", "#8664a5", "#533f70"] },
  { name: "Turquesa", shades: ["#94c1c1", "#39838a", "#25545d"] },
  { name: "Terracota", shades: ["#e4b0a1", "#c46f59", "#7e4638"] },
  { name: "Oliva", shades: ["#c4cb9b", "#8b9957", "#535d34"] },
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
  const family = categoryColorFamilies.find((family) =>
    family.shades.some((shade) => shade === color),
  );
  const tone = family?.shades.findIndex((shade) => shade === color) ?? 1;
  const rgb = [1, 3, 5]
    .map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return {
    "--badge-color": color,
    "--category-text": `color-mix(in srgb, ${color} 45%, #172621)`,
    "--category-contrast": luminance > 0.179 ? "#172621" : "#ffffff",
    "--category-surface": `color-mix(in srgb, ${color} ${[15, 25, 45][tone]}%, #fff)`,
  } as CSSProperties;
}
