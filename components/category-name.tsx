"use client";
import { useCategoryColors } from "./category-colors";
import { badgeStyle } from "@/lib/visual-colors";
export default function CategoryName({
  name,
  kind = "expense",
}: {
  name: string;
  kind?: string;
}) {
  const { color } = useCategoryColors();
  return (
    <span
      className="category-colored-name"
      style={badgeStyle(color(name, kind))}
    >
      <i aria-hidden="true" />
      {name}
    </span>
  );
}
