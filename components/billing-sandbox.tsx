"use client";
import { useEffect, useState } from "react";
import { brl, plans, type BillingCycle } from "@/lib/plans";
import SandboxRenewalSimulator from "./sandbox-renewal-simulator";
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
    appliedRenewals?: {payment_id:string;order_id:string;due_date:string;previous_valid_until:string;new_valid_until:string;applied_at:string}[];
    lifecycleSummary?: Record<string, {
      state: string; successfulCharges: number; pendingCharges: number;
      problemCharges: number; lastEvent: string | null;
    }>;
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
  const [chargeGeneration, setChargeGeneration] = useState<{orderId:string;message:string;error:boolean}|null>(null);
  const [renewalReview, setRenewalReview] = useState<{
    orderId: string; candidates: { chargeId: string; dueDate: string; status: string; projectedUntil: string | null; readyForReview: boolean }[];
    morePages: boolean; listedPayments:number;
    paymentSummary: {dueDate:string;status:string;matchesSubscription:boolean;matchesAmount:boolean}[];
  } | null>(null);
  const [candidates, setCandidates] = useState<{ orderId: string; options: { id: string; value: number; cycle: string; dateCreated?: string; nextDueDate?: string }[] } | null>(null);
  async function load() {
    const r = await fetch("/api/admin/billing");
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || "Não foi possível conectar.");
    setState(body);
  }
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);
  async function run(action: string, id?: string, subscriptionId?: string) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(
        action === "checkout" ? "/api/billing/checkout" : "/api/admin/billing",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "checkout" ? { cycle, method } : { action, id, subscriptionId, confirmed: action === "link-subscription" || action === "generate-next-charge" },
          ),
        },
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Não foi possível concluir.");
      if (body.url) {
        window.location.assign(body.url);
        return;
      }
      if (action === "generate-next-charge") {
        await load();
        const generationMessage = body.alreadyGenerated
          ? "Já havia uma cobrança com esse vencimento no Asaas. Nenhuma outra foi solicitada."
          : body.found
            ? "O Asaas retornou uma cobrança do próximo período. Ela ainda não foi considerada paga."
            : "A API aceitou a geração, mas a consulta seguinte ainda não retornou cobrança correspondente. Não repita a operação; revise a conferência.";
        setChargeGeneration({orderId:id!,message:generationMessage,error:false});
        setMessage(generationMessage);
        return;
      }
      if (action === "review-renewal") {
        setRenewalReview({orderId: id!, candidates: body.candidates ?? [], morePages: body.morePages === true, listedPayments:body.listedPayments ?? 0, paymentSummary:body.paymentSummary ?? []});
        setMessage("Conciliação de leitura concluída. Nenhuma validade ou cobrança foi alterada.");
        return;
      }
      if (action === "find-subscriptions") {
        setCandidates({ orderId: id!, options: body.candidates || [] });
        setMessage(body.candidates?.length
          ? "Confira a data e o valor antes de vincular. Não será feita outra cobrança."
          : "Não foi encontrada assinatura compatível. Verifique se a assinatura aparece na conta Sandbox correta.");
        return;
      }
      if (action === "link-subscription") setCandidates(null);
      await load();
      const statuses = Array.isArray(body.paymentStatuses) && body.paymentStatuses.length
        ? " Status da cobrança: " + body.paymentStatuses.join(", ") + "."
        : "";
      setMessage(
        action === "connect"
          ? "Asaas conectado. Você já pode testar os planos."
          : action === "link-subscription"
            ? "Assinatura de teste vinculada após confirmação administrativa."
          : body.linked
            ? "Assinatura recorrente vinculada ao pedido de teste."
            : body.reason === "no_matching_payment"
              ? "O checkout está marcado como pago, mas a API não retornou cobrança do mesmo valor para esta sessão. A confirmação do checkout permanece preservada. Confira a assinatura no Sandbox, sem criar outra cobrança."
              : body.reason === "payment_not_settled"
                ? "O checkout está registrado, mas a API ainda não considera a cobrança liquidada." + statuses + " Não é necessário pagar novamente."
                : body.reason === "subscription_missing"
                  ? "Checkout confirmado, mas nenhum ID de assinatura foi encontrado na cobrança nem pela referência exata do pedido." + statuses + " Confira a área de Assinaturas do Sandbox."
                  : body.reason === "pix_confirmed"
                    ? "Pagamento Pix de teste confirmado, sem renovação automática."
                    : "Resultado consultado no Asaas." + statuses,
      );
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Tente novamente.";
      if (action === "generate-next-charge") {
        setChargeGeneration({orderId:id!,message:"A geração não foi confirmada: " + reason + " Não repita até conferir as cobranças existentes.",error:true});
      }
      setMessage(reason);
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
                {o.provider_subscription_id && (
                  <div role="status" className="sandbox-lifecycle-summary">
                    {(() => {
                      const summary = state?.lifecycleSummary?.[o.id];
                      if (!summary) return <p>Conferindo eventos de recorrência…</p>;
                      const messages: Record<string, string> = {
                        awaiting_events: "Assinatura vinculada. Aguardando eventos de novas cobranças.",
                        payment_observed: "Pagamento associado à assinatura detectado; confirmar o vencimento antes de considerar uma renovação.",
                        payment_pending: "Existe cobrança recorrente pendente no histórico.",
                        payment_problem: "Atenção: há cobrança vencida ou tentativa de cartão recusada.",
                        refund_or_dispute: "Atenção: estorno ou contestação detectado. Revisão administrativa necessária.",
                        subscription_stopped: "Atenção: assinatura inativada ou excluída no Asaas.",
                      };
                      return (
                        <p><strong>Monitoramento:</strong> {messages[summary.state] || "Revisar eventos no painel."}
                          {" "}Confirmadas: {summary.successfulCharges}; pendentes: {summary.pendingCharges}; com falha: {summary.problemCharges}.
                          {" "}Esta leitura não altera o Premium real nem o período simulado.
                        </p>
                      );
                    })()}
                  </div>
                )}
                {panel && o.method === "card" && o.status === "paid" &&
                  o.provider_subscription_id && o.sandbox_entitlement?.validUntil && (
                    <div className="sandbox-charge-generation">
                      <p>Homologação do próximo período: o Asaas Sandbox pode antecipar a criação da cobrança futura. Isso não paga a cobrança nem altera o Premium.</p>
                      <button type="button" disabled={busy} onClick={() => {
                        if (window.confirm("Gerar antecipadamente apenas a cobrança do PRÓXIMO período no Asaas SANDBOX? Não haverá pagamento, mas uma nova cobrança de teste poderá aparecer na conta Asaas.")) {
                          void run("generate-next-charge",o.id);
                        }
                      }}>
                        Gerar cobrança futura de teste
                      </button>
                      {chargeGeneration?.orderId === o.id && (
                        <p role="status"><strong>{chargeGeneration.error ? "Atenção:" : "Resultado da geração:"}</strong> {chargeGeneration.message}</p>
                      )}
                    </div>
                  )}
                {panel && o.method === "card" && o.status === "paid" && o.provider_subscription_id && (
                  <div className="sandbox-renewal-review">
                    <button type="button" disabled={busy} onClick={() => run("review-renewal", o.id)}>
                      Conferir cobranças da assinatura no Asaas
                    </button>
                    {renewalReview?.orderId === o.id && (
                      <div role="status">
                        <p><strong>Conferência de leitura:</strong> a validade registrada não foi alterada.</p>
                        <p><strong>Cobranças retornadas pelo Asaas:</strong> {renewalReview.listedPayments}.</p>
                        {renewalReview.paymentSummary.map((p,i) => (
                          <p key={i}>Cobrança {i+1}: vencimento {p.dueDate || "não informado"} · {p.status}.
                            {p.matchesSubscription ? "" : " Identificador de assinatura não correspondente."}
                            {p.matchesAmount ? "" : " Valor não correspondente."}
                          </p>
                        ))}
                        {!renewalReview.candidates.length && (
                          <p>Nenhuma cobrança do próximo período foi encontrada. Não significa falha no pagamento; a próxima cobrança pode não ter sido gerada ainda.</p>
                        )}
                        {renewalReview.candidates.map(ch => (
                          <p key={ch.chargeId}>
                            Vencimento: {ch.dueDate} · Status no Asaas: {ch.status}.
                            {ch.readyForReview && ch.projectedUntil
                              ? " Candidata a renovação confirmada; projeção até " +
                                new Date(ch.projectedUntil).toLocaleDateString("pt-BR",{timeZone:"UTC"}) +
                                ". Requer homologação antes de aplicar."
                              : " Ainda não há confirmação suficiente para prorrogar o Premium."}
                          </p>
                        ))}
                        {renewalReview.morePages && <p>Há mais cobranças no Asaas; este resultado não é uma conferência completa.</p>}
                      </div>
                    )}
                  </div>
                )}
                {!!state.appliedRenewals?.filter(r => r.order_id === o.id).length && (
                  <div className="sandbox-renewal-history">
                    <h4>Renovações confirmadas pelo Asaas · Sandbox</h4>
                    {state.appliedRenewals.filter(r => r.order_id === o.id).map(r => (
                      <p key={r.payment_id}>
                        Cobrança {r.payment_id} · vencimento {r.due_date} · validade:
                        {" "}{new Date(r.previous_valid_until).toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"})}
                        {" → "}{new Date(r.new_valid_until).toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"})}
                      </p>
                    ))}
                    <small>Somente Premium simulado. Estornos são sinalizados para revisão, sem revogação automática.</small>
                  </div>
                )}
                {o.sandbox_entitlement?.state === "active" && o.sandbox_entitlement.validUntil && (
                  <p role="status"><strong>Premium simulado ativo</strong> até {new Date(o.sandbox_entitlement.validUntil).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Não altera o acesso real.</p>
                )}
                {o.sandbox_entitlement?.state === "expired" && <p>Premium simulado expirado. Acesso real inalterado.</p>}
                {panel && o.method === "card" && o.status === "paid" &&
                  o.provider_subscription_id && o.sandbox_entitlement?.validUntil &&
                  (o.cycle === "monthly" || o.cycle === "quarterly" || o.cycle === "yearly") && (
                    <SandboxRenewalSimulator
                      key={o.id + ":" + o.sandbox_entitlement.validUntil}
                      cycle={o.cycle}
                      baselineValidUntil={o.sandbox_entitlement.validUntil}
                    />
                  )}
                {o.method === "card" && o.status === "paid" && !o.provider_subscription_id && (
                  <button type="button" disabled={busy} onClick={() => run("find-subscriptions", o.id)}>
                    Localizar assinatura existente
                  </button>
                )}
                {candidates?.orderId === o.id && (
                  <div role="region" aria-label="Assinaturas candidatas no Sandbox">
                    <p>Conciliação manual de teste: confirme que a assinatura é a mesma exibida no Asaas. Isso não gera nova cobrança.</p>
                    {candidates.options.length === 0 && <p>Nenhuma assinatura compatível encontrada nesta consulta.</p>}
                    {candidates.options.map((candidate) => (
                      <div key={candidate.id}>
                        <p><strong>{candidate.id}</strong> · {brl(Math.round(candidate.value * 100))} · {candidate.cycle} · criada em {candidate.dateCreated || "data não disponível"} · próximo vencimento {candidate.nextDueDate || "não disponível"}</p>
                        <button type="button" disabled={busy} onClick={() => {
                          if (window.confirm("Confirma que esta é a assinatura do pagamento de teste do Nossa Conta? Nenhuma cobrança será criada.")) {
                            void run("link-subscription", o.id, candidate.id);
                          }
                        }}>Confirmar vínculo desta assinatura</button>
                      </div>
                    ))}
                  </div>
                )}
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
