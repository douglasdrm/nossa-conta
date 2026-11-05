"use client";
import { useState, useEffect } from "react";
type Invite = {
  id: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};
export default function SharePanel() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [link, setLink] = useState(""),
    [invites, setInvites] = useState<Invite[]>([]);
  async function load() {
    try {
      const r = await fetch("/api/invites");
      if (r.ok) setInvites(await r.json());
    } catch {
      setMessage("Não foi possível carregar os convites.");
    }
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <span className="tag">FINANÇAS EM CONJUNTO</span>
      <h2>Um espaço para vocês.</h2>
      <p>
        Convide pelo e-mail. A pessoa entrará com a própria conta e poderá
        consultar, adicionar, editar e excluir os lançamentos deste espaço.
      </p>
      <p>
        Somente o criador do espaço pode gerar convites. Nenhum e-mail é enviado
        automaticamente: copie o link e envie para a pessoa.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          setLink("");
          const email = new FormData(e.currentTarget).get("email");
          try {
            const r = await fetch("/api/invites", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            });
            const b = await r.json();
            if (!r.ok) throw Error(b.error);
            setLink(location.origin + "/invite?token=" + b.token);
            setMessage(
              "Convite criado. Válido por 7 dias e apenas para o e-mail informado.",
            );
            await load();
          } catch (e) {
            setMessage(
              e instanceof Error
                ? e.message
                : "Não foi possível criar o convite.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          E-mail da pessoa
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            placeholder="pessoa@email.com"
          />
        </label>
        <button className="primary save" disabled={busy}>
          {busy ? "Criando..." : "Gerar convite"}
        </button>
      </form>
      {link && (
        <div className="invite-link">
          <label>
            Link do convite
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setMessage("Link copiado. Envie para a pessoa convidada.");
              } catch {
                setMessage("Selecione o link acima e copie manualmente.");
              }
            }}
          >
            Copiar convite
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {invites.length > 0 && (
        <div className="invite-list">
          <h3>Convites recentes</h3>
          {invites.map((i) => (
            <div key={i.id}>
              <span>
                {i.email}
                <small>
                  {i.revoked_at
                    ? "Revogado"
                    : i.accepted_at
                      ? "Aceito"
                      : new Date(i.expires_at) < new Date()
                        ? "Expirado"
                        : "Pendente"}
                </small>
              </span>
              {!i.accepted_at &&
                !i.revoked_at &&
                new Date(i.expires_at) > new Date() && (
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        const r = await fetch("/api/invites", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: i.id }),
                        });
                        if (!r.ok) throw Error();
                        await load();
                        setLink("");
                        setMessage("Convite revogado.");
                      } catch {
                        setMessage("Não foi possível revogar.");
                      }
                    }}
                  >
                    Revogar
                  </button>
                )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
