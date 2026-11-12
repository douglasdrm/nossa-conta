"use client";
import { useState } from "react";
import { readAttribution } from "@/lib/marketing/attribution";
import type { BillingCycle } from "@/lib/plans";
export default function SubscriptionInterest({
  cycle,
}: {
  cycle: BillingCycle;
}) {
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/acquisition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...readAttribution(), cycle }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Não foi possível registrar.");
      setStatus(
        "Interesse registrado! Você pode continuar usando os recursos atuais gratuitamente. Nenhuma cobrança foi feita.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        className="marketing-cta"
        type="button"
        disabled={busy}
        onClick={submit}
      >
        {busy ? "Registrando…" : "Registrar meu interesse, sem cobrança"}
      </button>
      {status && <p role="status">{status}</p>}
    </div>
  );
}
