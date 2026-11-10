import type { CSSProperties } from "react";
import { expenseCategories } from "./categories";
import type { PaymentMethod } from "./payment-methods";

const categoryPalette = [
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
];

export function categoryColor(name: string) {
  const index = expenseCategories.indexOf(name);
  if (index >= 0) return categoryPalette[index];
  let hash = 0;
  for (const character of name.toLocaleLowerCase("pt-BR"))
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return categoryPalette[hash % categoryPalette.length];
}

export const profileColors = [
  "green",
  "blue",
  "violet",
  "rose",
  "amber",
  "teal",
] as const;
export type ProfileColor = (typeof profileColors)[number];
export const profileColorOptions: Record<
  ProfileColor,
  { label: string; hex: string }
> = {
  green: { label: "Verde", hex: "#286653" },
  blue: { label: "Azul", hex: "#5473ac" },
  violet: { label: "Lilás", hex: "#8664a5" },
  rose: { label: "Rosa", hex: "#b7557c" },
  amber: { label: "Âmbar", hex: "#b4792f" },
  teal: { label: "Turquesa", hex: "#39838a" },
};

export const paymentColors: Record<PaymentMethod, string> = {
  pix: "#39838a",
  cash: "#286653",
  credit_card: "#8664a5",
  debit_card: "#5473ac",
  bank_slip: "#b4792f",
  transfer: "#b7557c",
  other: "#728593",
};

export function badgeStyle(color: string): CSSProperties {
  return { "--badge-color": color } as CSSProperties;
}
