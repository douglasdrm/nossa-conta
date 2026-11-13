"use client";
import { useEffect, useState } from "react";
import { brl, plans, type BillingCycle } from "@/lib/plans";
export default function BillingSandbox({
  cycle = "yearly",
  panel = false,
}: {
  cycle?: BillingCycle;
  panel?: boolean;
}) {
  const [method, setMethod] = useState<"card" | "pix">("card");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [state, setState] = useState<{
    webhook: boolean;
    lifecycleEvents?: { id: string; order_id: string; resource_type: string; event_type: string; created_at: string }[];
    orders: {
      id: string;
      cycle: string;
      method: string;
      amount: number;
      status: string;
      created_at: string;
      checkout_id: string | null;
      provider_subscription_id: string | null;
      sandbox_entitlement?: { state: "active" | "expired" | "inactive"; validUntil: string | null };
    }[];
  } | null>(null);
  async function load() {
    const r = await fetch("/api/admin/billing");
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || "Não foi possível conectar.");
    setState(body);
  }
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);
  async function run(action: string, id?: string) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(
        action === "checkout" ? "/api/billing/checkout" : "/api/admin/billing",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "checkout" ? { cycle, method } : { action, id },
          ),
        },
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Não foi possível concluir.");
      if (body.url) {
        window.location.assign(body.url);
        return;
      }
      await load();
      setMessage(
        action === "connect"
          ? "Asaas conectado. Você já pode testar os planos."
          : "Resultado atualizado com o Asaas.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    creating: "Criando",
    pending: "Aguardando pagamento",
    paid: "Pago em teste",
    canceled: "Cancelado",
    expired: "Expirado",
    failed: "Falhou",
  };
  return (
    <section className="billing-sandbox" aria-label="Testes de cobrança">
      <h2>Asaas · ambiente de testes</h2>
      <p>
        Disponível somente para administradores. Os pagamentos são simulados e
        não alteram o acesso dos usuários.
      </p>
      <p>
        {state
          ? state.webhook
            ? "Conectado · confirmação automática ativa."
            : "Chave aceita · conecte a confirmação automática antes de testar."
          : "Conferindo conexão…"}
      </p>
      <button type="button" disabled={busy} onClick={() => run("connect")}>
        Conectar Asaas de testes
      </button>
      {panel ? (
        <div className="billing-test-plans">
          {plans.map((p) => (
            <a key={p.id} href={"/assinatura?periodo=" + p.id}>
              Testar {p.name.toLowerCase()} · {brl(p.total)}
            </a>
          ))}
        </div>
      ) : (
        <>
          <label>
            Forma de pagamento
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as "card" | "pix")}
            >
              <option value="card">Cartão · renovação automática</option>
              <option value="pix">Pix · pagamento único do período</option>
            </select>
          </label>
          <p>
            {method === "card"
              ? "O total do plano será cobrado a cada período. Não é parcelamento."
              : "O Pix paga somente o período escolhido, sem renovação automática."}
          </p>
          <button
            type="button"
            disabled={busy || !state?.webhook}
            onClick={() => run("checkout")}
          >
            {busy ? "Aguarde…" : "Abrir checkout de teste"}
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {!!state?.orders.length && (
        <>
          <h3>Últimos testes</h3>
          <div className="billing-orders">
            {state.orders.map((o) => (
              <article key={o.id}>
                <strong>
                  {plans.find((p) => p.id === o.cycle)?.name} · {brl(o.amount)}
                </strong>
                <p>
                  {o.method === "card" ? "Cartão recorrente" : "Pix"} ·{" "}
                  {labels[o.status] || o.status}
                </p>
                <small>{new Date(o.created_at).toLocaleString("pt-BR")}</small>
                {o.method === "card" && o.status === "paid" && (
                  <p>Assinatura recorrente: <strong>{o.provider_subscription_id ? "vinculada para monitoramento" : "vínculo pendente — clique em Atualizar resultado"}</strong></p>
                )}
                {o.sandbox_entitlement?.state === "active" && o.sandbox_entitlement.validUntil && (
                  <p role="status"><strong>Premium simulado ativo</strong> até {new Date(o.sandbox_entitlement.validUntil).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Não altera o acesso real.</p>
                )}
                {o.sandbox_entitlement?.state === "expired" && <p>Premium simulado expirado. Acesso real inalterado.</p>}
                {o.checkout_id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run("sync", o.id)}
                  >
                    Atualizar resultado
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {!!state?.lifecycleEvents?.length && (
        <section aria-label="Eventos de recorrência de teste">
          <h3>Histórico de renovações e ocorrências · Sandbox</h3>
          <div className="billing-orders">
            {state.lifecycleEvents.map((event) => (
              <article key={event.id}>
                <strong>{event.event_type.replaceAll("_", " ")}</strong>
                <small>{new Date(event.created_at).toLocaleString("pt-BR")}</small>
                <small>{event.resource_type === "payment" ? "Cobrança" : "Assinatura"} · evento associado a um pedido do Nossa Conta</small>
              </article>
            ))}
          </div>
        </section>
      )}
      <p>
        O histórico de eventos é somente um monitor de testes: não ativa nem suspende Premium real. Renovações e estornos precisam ser homologados antes de usar produção.
      </p>
      <p>
        Após pagar, a confirmação pode levar alguns instantes. Voltar do
        checkout não confirma pagamento. Esta etapa registra o resultado
        inicial; renovações, estornos e cancelamento de assinatura serão
        validados antes de liberar vendas.
      </p>
    </section>
  );
}
