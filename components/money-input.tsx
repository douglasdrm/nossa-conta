"use client";
import { useState } from "react";
import { maskMoneyInput, moneyInputFromCents } from "@/lib/finance";
export default function MoneyInput({
  defaultCents,
}: {
  defaultCents?: number;
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
      onChange={(e) => setValue(maskMoneyInput(e.target.value))}
      aria-describedby="money-help"
    />
  );
}
