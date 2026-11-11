"use client";
import Brand from "@/components/brand";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
export default function Reset() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <main className="auth-page">
      <section className="auth-card">
        <a href="/" className="auth-brand" aria-label="Nossa Conta — início">
          <Brand stacked />
        </a>
        <h1>Uma nova senha.</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            const f = new FormData(e.currentTarget);
            const password = String(f.get("password"));
            if (password !== f.get("confirm")) {
              setMessage("As senhas precisam ser iguais.");
              setBusy(false);
              return;
            }
            try {
              const db = createClient();
              const {
                data: { user },
              } = await db.auth.getUser();
              if (!user) throw Error();
              const { error } = await db.auth.updateUser({ password });
              if (error) throw error;
              location.assign("/");
            } catch {
              setMessage(
                "Não foi possível alterar. Abra um novo link de recuperação e tente novamente.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Nova senha
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
            />
          </label>
          <label>
            Repita a senha
            <input
              type="password"
              name="confirm"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
            />
          </label>
          {message && <p role="status">{message}</p>}
          <button className="primary save" disabled={busy}>
            {busy ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
        <a className="text-button" href="/login">
          Voltar para o login
        </a>
      </section>
    </main>
  );
}
