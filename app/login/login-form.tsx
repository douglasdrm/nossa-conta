"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/validation";
export default function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      params.get("error")
        ? "O link expirou ou não pôde ser confirmado. Tente entrar novamente."
        : "",
    );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const f = new FormData(event.currentTarget);
    const email = String(f.get("email")).trim();
    const password = String(f.get("password") || "");
    try {
      const db = createClient();
      if (mode === "reset") {
        const { error } = await db.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + "/auth/callback?next=/reset-password",
        });
        if (error) throw error;
        setMessage(
          "Se houver uma conta com esse e-mail, você receberá um link para redefinir a senha.",
        );
      } else if (mode === "signup") {
        const { data, error } = await db.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: String(f.get("name")).trim() },
            emailRedirectTo:
              location.origin +
              "/auth/callback?next=" +
              encodeURIComponent(next),
          },
        });
        if (error) throw error;
        if (data.session) location.assign(next);
        else
          setMessage(
            "Confira seu e-mail e confirme o cadastro pelo link. Depois, entre na sua conta.",
          );
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        location.assign(next);
      }
    } catch {
      setMessage(
        mode === "login"
          ? "Não foi possível entrar. Confira e-mail, senha e confirmação do cadastro."
          : "Não foi possível enviar. Confira os dados ou aguarde antes de tentar novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <a href="/" className="auth-brand">
          Nossa Conta.
        </a>
        <span className="tag">FINANÇAS EM CONJUNTO</span>
        <h1>
          {mode === "signup"
            ? "Comecem por aqui."
            : mode === "reset"
              ? "Recupere seu acesso."
              : "Bom ter você por aqui."}
        </h1>
        <p>Um lugar para entender os gastos e organizar os planos da casa.</p>
        {next.startsWith("/invite") && (
          <p className="notice">
            Você recebeu um convite. Entre ou crie uma conta com o e-mail
            convidado para continuar.
          </p>
        )}
        <form onSubmit={submit}>
          {mode === "signup" && (
            <label>
              Seu nome
              <input
                name="name"
                required
                maxLength={60}
                autoComplete="given-name"
              />
            </label>
          )}
          <label>
            E-mail
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              maxLength={254}
            />
          </label>
          {mode !== "reset" && (
            <label>
              Senha
              <input
                name="password"
                type="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
              />
            </label>
          )}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          <button className="primary save" disabled={busy}>
            {busy
              ? "Aguarde..."
              : mode === "signup"
                ? "Criar conta"
                : mode === "reset"
                  ? "Enviar link de recuperação"
                  : "Entrar"}
          </button>
        </form>
        <div className="auth-links">
          <button
            onClick={() => {
              setMode(mode === "signup" ? "login" : "signup");
              setMessage("");
            }}
          >
            {mode === "signup" ? "Já tenho uma conta" : "Criar minha conta"}
          </button>
          <button
            onClick={() => {
              setMode(mode === "reset" ? "login" : "reset");
              setMessage("");
            }}
          >
            {mode === "reset" ? "Voltar para entrar" : "Esqueci minha senha"}
          </button>
        </div>
      </section>
    </main>
  );
}
