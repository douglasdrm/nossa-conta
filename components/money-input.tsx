"use client";
import { useState } from "react";
import {
  maskMoneyInput,
  moneyInputFromCents,
  moneyInputToCents,
} from "@/lib/finance";
export default function MoneyInput({
  defaultCents,
  onValueChange,
}: {
  defaultCents?: number;
  onValueChange?: (cents: number) => void;
}) {
  const [value, setValue] = useState(
    defaultCents === undefined ? "" : moneyInputFromCents(defaultCents),
  );
  return (
    <input
      name="amount"
      required
      inputMode="numeric"
      type="text"
      autoComplete="off"
      placeholder="0,00"
      value={value}
      onChange={(e) => {
        const next = maskMoneyInput(e.target.value);
        setValue(next);
        onValueChange?.(moneyInputToCents(next));
      }}
      aria-describedby="money-help"
    />
  );
}
