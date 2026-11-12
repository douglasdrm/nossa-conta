"use client";
import Brand from "@/components/brand";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/validation";
export default function LoginForm({
  administrative = false,
}: {
  administrative?: boolean;
}) {
  const params = useSearchParams();
  const next = administrative ? "/admin" : safeNext(params.get("next"));
  const [mode, setMode] = useState<"login" | "signup" | "reset">(
      !administrative && params.get("mode") === "signup" ? "signup" : "login",
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      params.get("error")
        ? "O link expirou ou não pôde ser confirmado. Tente entrar novamente."
        : "",
    );
  async function googleLogin() {
    setBusy(true);
    setMessage("");
    try {
      const db = createClient();
      const { error } = await db.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo:
            location.origin + "/auth/callback?next=" + encodeURIComponent(next),
        },
      });
      if (error) throw error;
    } catch {
      setMessage("Não foi possível entrar com Google. Tente novamente.");
      setBusy(false);
    }
  }
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
        <a href="/" className="auth-brand" aria-label="Nossa Conta — início">
          <Brand stacked />
        </a>
        <span className="tag">
          {administrative
            ? "ADMINISTRAÇÃO DO NOSSA CONTA"
            : "FINANÇAS EM CONJUNTO"}
        </span>
        <h1>
          {administrative && mode !== "reset"
            ? "Acesso administrativo."
            : mode === "signup"
              ? "Comecem por aqui."
              : mode === "reset"
                ? "Recupere seu acesso."
                : "Bom ter você por aqui."}
        </h1>
        <p>
          {administrative
            ? "Entre com uma conta autorizada para gerenciar clientes, leads e assinaturas. Assinar o Premium não concede acesso a esta área."
            : "Um lugar para entender os gastos e organizar os planos da casa."}
        </p>
        {next.startsWith("/invite") && (
          <p className="notice">
            Você recebeu um convite. Entre ou crie uma conta com o e-mail
            convidado para continuar.
          </p>
        )}
        {mode !== "reset" && (
          <>
            <button
              type="button"
              className="secondary google-login"
              disabled={busy}
              onClick={googleLogin}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
              >
                <path
                  fill="currentColor"
                  d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.03v2.52h3.25c1.9-1.75 2.97-4.33 2.97-7.38ZM12 22c2.7 0 4.96-.9 6.62-2.42l-3.25-2.52c-.9.6-2.05.96-3.37.96-2.6 0-4.8-1.76-5.58-4.13H3.06v2.6A10 10 0 0 0 12 22ZM6.42 13.89a6 6 0 0 1 0-3.78V7.5H3.06a10 10 0 0 0 0 9l3.36-2.61ZM12 5.98c1.47 0 2.79.51 3.83 1.52l2.88-2.88A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.5l3.36 2.61C7.2 7.74 9.4 5.98 12 5.98Z"
                />
              </svg>{" "}
              Continuar com Google
            </button>
            <div className="auth-divider">ou use seu e-mail</div>
          </>
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
        {!administrative && (
          <p className="shared-account-note">
            Já usa o Juntô? Você pode entrar com a mesma conta. Os espaços e
            lançamentos do Nossa Conta são separados.
          </p>
        )}
        <div className="auth-links">
          {!administrative && (
            <button
              onClick={() => {
                setMode(mode === "signup" ? "login" : "signup");
                setMessage("");
              }}
            >
              {mode === "signup" ? "Já tenho uma conta" : "Criar minha conta"}
            </button>
          )}
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
