import {
  expenseCategories,
  incomeCategories,
  type CategoryItem,
} from "./categories";

// Defaults keep their identity even when their display name is changed.
const defaultColors = [
  "#286653",
  "#d9a65d",
  "#8b9dcd",
  "#d47763",
  "#9ba970",
  "#69a6aa",
  "#c68eac",
  "#a29685",
  "#728593",
  "#c7bfab",
  "#5473ac",
  "#8664a5",
  "#39838a",
  "#b7557c",
];
const defaults = [...expenseCategories, ...incomeCategories];

export function categoryColor(identity: string): string {
  const index = defaults.indexOf(identity);
  if (index >= 0) return defaultColors[index];
  let hash = 2166136261;
  for (const character of identity.normalize("NFC"))
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  const hue = (hash % 36000) / 100;
  const saturation = (46 + ((hash >>> 16) % 25)) / 100;
  const lightness = (37 + ((hash >>> 24) % 15)) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const rgb =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return (
    "#" +
    rgb
      .map((channel) =>
        Math.round((channel + offset) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function colorCategories(
  items: (Omit<CategoryItem, "color"> & { colorIdentity: string })[],
): CategoryItem[] {
  const assigned = new Map<string, string>();
  const used = new Set(defaultColors);
  // UUID ordering means renaming/reordering labels never changes the assigned color.
  for (const identity of [
    ...new Set(items.map((item) => item.colorIdentity)),
  ].sort()) {
    if (defaults.includes(identity)) {
      assigned.set(identity, categoryColor(identity));
      continue;
    }
    let color = categoryColor(identity);
    let attempt = 0;
    while (used.has(color)) color = categoryColor(identity + ":" + ++attempt);
    assigned.set(identity, color);
    used.add(color);
  }
  return items.map(({ colorIdentity, ...item }) => ({
    ...item,
    color: assigned.get(colorIdentity)!,
  }));
}
