"use client";
import Brand from "@/components/brand";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
export default function AcceptInvite({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <Brand stacked />
        </div>
        <h1>Organizar fica melhor juntos.</h1>
        <p>
          Você está entrando como <b>{email}</b>. Ao aceitar, poderá ver e
          alterar os lançamentos do espaço compartilhado.
        </p>
        <p>
          O convite só funciona com o e-mail convidado. Se você já tem
          lançamentos em outro espaço, eles serão preservados e a troca não será
          feita.
        </p>
        {message && (
          <p className="notice" role="alert">
            {message}
          </p>
        )}
        <button
          disabled={busy}
          className="primary save"
          onClick={async () => {
            setBusy(true);
            try {
              const db = createClient();
              const { error } = await db.rpc("nc_accept_household_invite", {
                p_token: token,
              });
              if (error) {
                if (error.message.includes("existing_household"))
                  setMessage(
                    "Você já participa de um espaço com lançamentos. Use uma conta que ainda não tenha um espaço com dados.",
                  );
                else
                  setMessage(
                    "O convite pode estar expirado, revogado ou destinado a outro e-mail. Peça um novo convite.",
                  );
                return;
              }
              location.assign("/");
            } catch {
              setMessage("Não foi possível aceitar agora. Tente novamente.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Entrando..." : "Aceitar convite"}
        </button>
        <form action="/auth/signout" method="post">
          <button className="text-button">Entrar com outra conta</button>
        </form>
        <a href="/" className="text-button">
          Voltar ao início
        </a>
      </section>
    </main>
  );
}
