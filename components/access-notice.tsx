"use client";
import "./access.css";
import { useEffect } from "react";
import type { AccountAccess } from "@/lib/access";

export default function AccessNotice({ access }: { access: AccountAccess }) {
  useEffect(() => {
    if (!access.valid_until || access.kind === "admin") return;
    const remaining = new Date(access.valid_until).valueOf() - Date.now();
    if (remaining <= 0 || remaining > 2_147_483_000) return;
    const timer = window.setTimeout(() => location.reload(), remaining + 1000);
    return () => window.clearTimeout(timer);
  }, [access.kind, access.valid_until]);
  if (access.kind === "admin" || access.kind === "paid" || access.kind === "courtesy") return null;
  const trialDays = access.trial_until
    ? Math.max(0, Math.ceil((new Date(access.trial_until).valueOf() - Date.now()) / 86_400_000))
    : 0;
  return (
    <div className="premium-access-notice" role="status">
      <div>
        <strong>{access.kind === "trial" ? `${trialDays} ${trialDays === 1 ? "dia" : "dias"} de Premium grátis` : "Modo gratuito individual"}</strong>
        <p>{access.kind === "trial"
          ? "Experimente os recursos completos e convide outras pessoas para o seu espaço."
          : "Continue com receitas, despesas e o resumo do mês. Seus dados e participantes continuam guardados."}</p>
      </div>
      <a href="/assinatura?periodo=monthly">{access.kind === "trial" ? "Ver assinatura" : "Ativar Premium"}</a>
    </div>
  );
}
