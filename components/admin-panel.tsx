"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import BillingSandbox from "./billing-sandbox";
import Brand from "./brand";
import { leadStages, type Lead, type AdminData } from "@/lib/commercial";
import { plans, brl } from "@/lib/plans";
import "./admin-panel.css";
const date = (value: string) =>
  new Date(value).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
const tabs = {
  overview: "Visão geral",
  leads: "Leads",
  users: "Usuários",
  subscriptions: "Espaços e assinaturas",
  plans: "Planos",
  billing: "Cobranças · testes",
  audit: "Histórico",
};
const actions: Record<string, string> = {
  lead_created: "Lead criado",
  lead_updated: "Lead atualizado",
  courtesy_granted: "Cortesia concedida",
  courtesy_revoked: "Cortesia encerrada",
};
const emptyLead = {
  id: null as string | null,
  name: "",
  email: "",
  phone: "",
  stage: "new" as Lead["stage"],
  notes: "",
  source: "manual",
};
export default function AdminPanel({
  data,
  page,
  search,
  tab,
}: {
  data: AdminData;
  page: number;
  search: string;
  tab: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const current = tab in tabs ? (tab as keyof typeof tabs) : "overview";
  const [lead, setLead] = useState<typeof emptyLead | null>(null),
    [courtesy, setCourtesy] = useState<{
      household: string;
      name: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (lead || courtesy) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [lead, courtesy]);
  const href = (nextTab: string, p = 1) =>
    "/admin?" +
    new URLSearchParams({ tab: nextTab, q: search, p: String(p) }).toString();
  async function mutate(payload: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Não foi possível salvar.");
      setLead(null);
      setCourtesy(null);
      setNotice("Alteração salva.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  const count =
    current === "leads"
      ? data.lead_count
      : current === "users"
        ? data.user_count
        : data.household_count;
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a href="/">
          <Brand variant="white" />
        </a>
        <span className="admin-caption">ADMINISTRAÇÃO</span>
        <nav aria-label="Administração">
          {Object.entries(tabs).map(([key, title]) => (
            <a
              key={key}
              href={href(key)}
              aria-current={key === current ? "page" : undefined}
            >
              {title}
            </a>
          ))}
        </nav>
        <a href="/">Voltar ao aplicativo</a>
        <form action="/auth/signout" method="post">
          <input type="hidden" name="next" value="/admin/login" />
          <button type="submit" className="admin-signout">
            Sair da conta
          </button>
        </form>
      </aside>
      <main className="admin-main">
        <header>
          <div>
            <span className="admin-caption">NOSSA CONTA · GESTÃO</span>
            <h1>{tabs[current]}</h1>
            <p>
              Organize clientes e oportunidades sem acessar as finanças
              pessoais.
            </p>
          </div>
          <a href="/planos">Ver página de planos ↗</a>
        </header>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {!lead && !courtesy && error && <p role="alert">{error}</p>}
        {current === "overview" && (
          <>
            <div className="admin-metrics">
              {[
                ["Usuários confirmados", data.summary.users],
                ["Espaços criados", data.summary.households],
                ["Leads", data.summary.leads],
                ["Interesses em planos", data.summary.interested],
                ["Cortesias ativas", data.summary.courtesies],
                ["Usuários com lançamento", data.summary.activated],
                ["Convites aceitos", data.summary.accepted_invites],
              ].map(([label, value]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>
            <section className="admin-card">
              <h2>Origem dos leads</h2>
              <p>
                A origem é registrada no primeiro acesso disponível neste
                navegador. Contatos manuais e cadastros anteriores podem não ter
                atribuição.
              </p>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Origem</th>
                      <th>Leads</th>
                      <th>Interesse em plano</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((s) => (
                      <tr key={s.source}>
                        <td>{s.source}</td>
                        <td>{s.registrations}</td>
                        <td>{s.interested}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.sources.length && (
                <p>A origem dos novos cadastros aparecerá aqui.</p>
              )}
            </section>
            <section className="admin-card">
              <h2>Cobrança em preparação</h2>
              <p>
                Ainda não há integração de pagamentos. Interesse em plano e
                cortesia não representam receita ou uma assinatura paga. O funil
                comercial é atualizado pela equipe.
              </p>
            </section>
          </>
        )}
        {["leads", "users", "subscriptions"].includes(current) && (
          <form className="admin-toolbar" method="get">
            <input type="hidden" name="tab" value={current} />
            <label>
              Buscar
              <input
                name="q"
                maxLength={120}
                defaultValue={search}
                placeholder={
                  current === "leads"
                    ? "Nome, e-mail ou origem"
                    : "Nome ou e-mail"
                }
              />
            </label>
            <button type="submit">Buscar</button>
            <a href={"/admin?tab=" + current}>Limpar</a>
            {current === "leads" && (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setLead({ ...emptyLead });
                }}
              >
                Adicionar lead
              </button>
            )}
          </form>
        )}
        {current === "leads" && (
          <section className="admin-card">
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Contato</th>
                    <th>Etapa</th>
                    <th>Interesse</th>
                    <th>Origem</th>
                    <th>Cadastro</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leads.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <b>{l.name}</b>
                        <small>{l.email}</small>
                        <small>{l.phone}</small>
                      </td>
                      <td>
                        <span className="admin-badge">
                          {leadStages[l.stage]}
                        </span>
                      </td>
                      <td>
                        {plans.find((p) => p.id === l.cycle)?.name || "—"}
                      </td>
                      <td>
                        {l.source}
                        <small>
                          {[l.medium, l.campaign].filter(Boolean).join(" · ")}
                        </small>
                        <small>{l.landing_path}</small>
                      </td>
                      <td>{date(l.created_at)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setLead({
                              id: l.id,
                              name: l.name,
                              email: l.email,
                              phone: l.phone,
                              stage: l.stage,
                              notes: l.notes,
                              source: l.source,
                            });
                          }}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.leads.length && <p>Nenhum lead encontrado.</p>}
          </section>
        )}
        {current === "users" && (
          <section className="admin-card">
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuário</th>
                    <th>Cadastro</th>
                    <th>Uso inicial</th>
                    <th>Espaço</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <b>{u.name}</b>
                        <small>{u.email}</small>
                      </td>
                      <td>{date(u.created_at)}</td>
                      <td>
                        {u.activated
                          ? "Já registrou um lançamento"
                          : "Sem lançamento"}
                      </td>
                      <td>
                        {u.household_id ? "Vinculado" : "Ainda não criou"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.users.length && <p>Nenhum usuário encontrado.</p>}
          </section>
        )}
        {current === "subscriptions" && (
          <section className="admin-card">
            <p>
              As cortesias têm prazo e ficam registradas no histórico. Os
              recursos atuais estão liberados gratuitamente para todos enquanto
              a cobrança é preparada.
            </p>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Espaço / responsável</th>
                    <th>Pessoas</th>
                    <th>Situação</th>
                    <th>Validade</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.households.map((h) => (
                    <tr key={h.id}>
                      <td>
                        <b>{h.name}</b>
                        <small>{h.owner_email}</small>
                        {h.reason && <small>{h.reason}</small>}
                      </td>
                      <td>{h.members}</td>
                      <td>
                        <span className="admin-badge">
                          {{
                            free: "Gratuito",
                            courtesy: "Cortesia Premium",
                            expired: "Cortesia expirada",
                          }[h.status] || h.status}
                        </span>
                      </td>
                      <td>{h.valid_until ? date(h.valid_until) : "—"}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setCourtesy({ household: h.id, name: h.name });
                          }}
                        >
                          Gerenciar cortesia
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.households.length && <p>Nenhum espaço encontrado.</p>}
          </section>
        )}
        {["leads", "users", "subscriptions"].includes(current) && (
          <nav className="admin-pagination" aria-label="Paginação">
            <span>
              {count} registros · página {page} · até 25 por página
            </span>
            {page > 1 && <a href={href(current, page - 1)}>← Anterior</a>}
            {page * 25 < count && (
              <a href={href(current, page + 1)}>Próxima →</a>
            )}
          </nav>
        )}
        {current === "plans" && (
          <section className="admin-card">
            <h2>Premium por espaço compartilhado</h2>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Total</th>
                    <th>Equivalente mensal</th>
                    <th>Economia</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{brl(p.total)}</td>
                      <td>{brl(p.monthly)}</td>
                      <td>{brl(p.saving)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Catálogo de lançamento. Contratação, renovação automática,
              alteração de preços e cupons serão conectados ao processador de
              pagamentos. Nenhuma cobrança está habilitada.
            </p>
          </section>
        )}
        {current === "billing" && <BillingSandbox panel />}
        {current === "audit" && (
          <section className="admin-card">
            <h2>Últimas 20 alterações administrativas</h2>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Responsável</th>
                    <th>Alteração</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((a, i) => (
                    <tr key={a.created_at + i}>
                      <td>{date(a.created_at)}</td>
                      <td>{a.actor || "Conta removida"}</td>
                      <td>{actions[a.action] || a.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.audit.length && <p>As alterações aparecerão aqui.</p>}
          </section>
        )}
        <dialog
          ref={dialog}
          className="admin-overlay"
          aria-labelledby="admin-editor-title"
          onCancel={(e) => {
            if (busy) {
              e.preventDefault();
              return;
            }
            setLead(null);
            setCourtesy(null);
          }}
        >
          <section className="admin-editor">
            <h2 id="admin-editor-title">
              {lead
                ? lead.id
                  ? "Editar lead"
                  : "Adicionar lead"
                : "Gerenciar cortesia"}
            </h2>
            {error && <p role="alert">{error}</p>}
            {lead ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate({ action: "lead", ...lead });
                }}
              >
                <label>
                  Nome
                  <input
                    required
                    maxLength={120}
                    value={lead.name}
                    onChange={(e) => setLead({ ...lead, name: e.target.value })}
                  />
                </label>
                <label>
                  E-mail
                  <input
                    required
                    type="email"
                    maxLength={254}
                    value={lead.email}
                    onChange={(e) =>
                      setLead({ ...lead, email: e.target.value })
                    }
                  />
                </label>
                <label>
                  Telefone
                  <input
                    type="tel"
                    maxLength={40}
                    value={lead.phone}
                    onChange={(e) =>
                      setLead({ ...lead, phone: e.target.value })
                    }
                  />
                </label>
                <label>
                  Etapa
                  <select
                    value={lead.stage}
                    onChange={(e) =>
                      setLead({
                        ...lead,
                        stage: e.target.value as Lead["stage"],
                      })
                    }
                  >
                    {Object.entries(leadStages).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                {!lead.id && (
                  <label>
                    Origem
                    <input
                      maxLength={120}
                      value={lead.source}
                      onChange={(e) =>
                        setLead({ ...lead, source: e.target.value })
                      }
                    />
                  </label>
                )}
                <label>
                  Anotações
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={lead.notes}
                    onChange={(e) =>
                      setLead({ ...lead, notes: e.target.value })
                    }
                  />
                </label>
                <div className="admin-editor-actions">
                  <button disabled={busy} type="submit">
                    {busy ? "Salvando…" : "Salvar lead"}
                  </button>
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() => setLead(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              courtesy && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const expires = String(f.get("until"));
                    void mutate({
                      action: "courtesy",
                      household: courtesy.household,
                      until: new Date(
                        expires + "T23:59:59-03:00",
                      ).toISOString(),
                      reason: String(f.get("reason")),
                    });
                  }}
                >
                  <p>{courtesy.name}</p>
                  <label>
                    Válida até
                    <input required type="date" name="until" />
                  </label>
                  <p>Para encerrar uma cortesia, escolha uma data passada.</p>
                  <label>
                    Motivo
                    <textarea
                      required
                      minLength={3}
                      maxLength={300}
                      name="reason"
                      rows={3}
                    />
                  </label>
                  <div className="admin-editor-actions">
                    <button disabled={busy} type="submit">
                      {busy ? "Salvando…" : "Salvar cortesia"}
                    </button>
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() => setCourtesy(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )
            )}
          </section>
        </dialog>
      </main>
    </div>
  );
}
