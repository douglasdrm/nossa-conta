"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, UserRound, LockKeyhole, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { avatarLimit } from "@/lib/profile";
export default function ProfileEditor({
  name,
  username,
  photo,
  email,
  pendingEmail,
}: {
  name: string;
  username: string;
  photo: string;
  email: string;
  pendingEmail: string;
}) {
  const router = useRouter();
  const [profileBusy, setProfileBusy] = useState(false),
    [photoBusy, setPhotoBusy] = useState(false),
    [emailBusy, setEmailBusy] = useState(false),
    [passwordBusy, setPasswordBusy] = useState(false),
    [needsCode, setNeedsCode] = useState(false);
  const [profileNote, setProfileNote] = useState(""),
    [photoNote, setPhotoNote] = useState(""),
    [emailNote, setEmailNote] = useState(""),
    [passwordNote, setPasswordNote] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  async function photoChange(file?: File, remove = false) {
    if (photoBusy) return;
    if (file && file.size > avatarLimit) {
      setPhotoNote("Use uma foto de até 3 MB.");
      return;
    }
    setPhotoBusy(true);
    setPhotoNote("");
    try {
      const body = new FormData();
      if (file) body.set("photo", file);
      const r = await fetch("/api/profile/avatar", {
        method: remove ? "DELETE" : "POST",
        body: remove ? undefined : body,
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(data.error || "Não foi possível atualizar a foto.");
      setPhotoNote(remove ? "Foto removida." : "Foto atualizada.");
      router.refresh();
    } catch (e) {
      setPhotoNote(
        e instanceof Error ? e.message : "Não foi possível atualizar a foto.",
      );
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <main className="profile-page">
      <a className="profile-back" href="/">
        <ArrowLeft size={18} /> Voltar para minhas finanças
      </a>
      <div className="profile-page-heading">
        <p className="eyebrow">SUA CONTA</p>
        <h1>Meu perfil</h1>
        <p>Deixe sua conta com a sua cara e mantenha seus dados atualizados.</p>
      </div>
      <div className="profile-layout">
        <section className="profile-card profile-photo-card">
          <h2>
            <Camera size={20} /> Foto do perfil
          </h2>
          <div className="profile-large-avatar">
            {photo ? (
              <img
                src={photo}
                alt="Sua foto de perfil"
                width={112}
                height={112}
              />
            ) : (
              <span>{name[0]?.toUpperCase()}</span>
            )}
          </div>
          <p>JPG, PNG ou WebP · até 3 MB</p>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            aria-label="Escolher foto do perfil"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void photoChange(file);
            }}
          />
          <button
            className="secondary"
            disabled={photoBusy}
            onClick={() => fileInput.current?.click()}
          >
            {photoBusy ? "Atualizando…" : "Trocar foto"}
          </button>
          {photo && (
            <button
              className="text-button"
              disabled={photoBusy}
              onClick={() => void photoChange(undefined, true)}
            >
              Remover foto
            </button>
          )}
          {photoNote && (
            <p role="status" className="profile-message">
              {photoNote}
            </p>
          )}
        </section>
        <section className="profile-card">
          <h2>
            <UserRound size={20} /> Dados pessoais
          </h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (profileBusy) return;
              setProfileBusy(true);
              setProfileNote("");
              const f = new FormData(e.currentTarget);
              try {
                const r = await fetch("/api/profile", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: f.get("name"),
                    username: f.get("username"),
                  }),
                });
                const data = await r.json();
                if (!r.ok) throw Error(data.error);
                setProfileNote("Perfil salvo.");
                router.refresh();
              } catch (error) {
                setProfileNote(
                  error instanceof Error
                    ? error.message
                    : "Não foi possível salvar.",
                );
              } finally {
                setProfileBusy(false);
              }
            }}
          >
            <label>
              Nome
              <input
                name="name"
                required
                maxLength={60}
                defaultValue={name}
                autoComplete="name"
              />
            </label>
            <label>
              Nome de usuário
              <input
                name="username"
                defaultValue={username}
                maxLength={30}
                pattern="[a-zA-Z0-9_]{3,30}"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                placeholder="Ex.: douglas_marinho"
              />
              <small className="field-hint">
                Opcional · de 3 a 30 letras sem acento, números ou _. O login
                continua sendo por e-mail ou Google.
              </small>
            </label>
            <button className="primary save" disabled={profileBusy}>
              {profileBusy ? "Salvando…" : "Salvar perfil"}
            </button>
            {profileNote && (
              <p role="status" className="profile-message">
                {profileNote}
              </p>
            )}
          </form>
        </section>
        <section className="profile-card">
          <h2>
            <Mail size={20} /> E-mail de acesso
          </h2>
          <p>
            Atual: <strong>{email}</strong>
          </p>
          {pendingEmail && (
            <p className="profile-message">
              Aguardando confirmação de {pendingEmail}.
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (emailBusy) return;
              setEmailBusy(true);
              setEmailNote("");
              const next = String(new FormData(e.currentTarget).get("email"))
                .trim()
                .toLowerCase();
              if (next === email.toLowerCase()) {
                setEmailNote("Este já é seu e-mail atual.");
                setEmailBusy(false);
                return;
              }
              try {
                const { data, error } = await createClient().auth.updateUser(
                  { email: next },
                  {
                    emailRedirectTo:
                      location.origin + "/auth/callback?next=/profile",
                  },
                );
                if (error) throw error;
                setEmailNote(
                  data.user?.new_email
                    ? "Solicitação enviada. Confirme a alteração nos e-mails recebidos; pode ser necessário confirmar no endereço atual e no novo."
                    : "E-mail atualizado.",
                );
                router.refresh();
              } catch {
                setEmailNote(
                  "Não foi possível solicitar a troca. Confira o endereço ou tente novamente mais tarde.",
                );
              } finally {
                setEmailBusy(false);
              }
            }}
          >
            <label>
              Novo e-mail
              <input
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="email"
                defaultValue={pendingEmail || ""}
                placeholder="seu@email.com"
              />
            </label>
            <button className="secondary" disabled={emailBusy}>
              {emailBusy ? "Enviando…" : "Solicitar alteração de e-mail"}
            </button>
            {emailNote && (
              <p role="status" className="profile-message">
                {emailNote}
              </p>
            )}
          </form>
        </section>
        <section className="profile-card">
          <h2>
            <LockKeyhole size={20} /> Alterar senha
          </h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (passwordBusy) return;
              const form = e.currentTarget,
                f = new FormData(form),
                password = String(f.get("password"));
              setPasswordNote("");
              if (password !== f.get("confirm")) {
                setPasswordNote("As senhas precisam ser iguais.");
                return;
              }
              setPasswordBusy(true);
              try {
                const current = String(f.get("current") || ""),
                  nonce = String(f.get("nonce") || "").trim();
                const { error } = await createClient().auth.updateUser({
                  password,
                  ...(current ? { current_password: current } : {}),
                  ...(nonce ? { nonce } : {}),
                });
                if (error) {
                  if (
                    [
                      "reauthentication_needed",
                      "reauthentication_not_valid",
                      "reauth_nonce_missing",
                    ].includes(error.code || "")
                  ) {
                    setNeedsCode(true);
                    setPasswordNote(
                      "Confirme sua identidade: solicite o código por e-mail abaixo e informe-o para salvar a nova senha.",
                    );
                    return;
                  }
                  setPasswordNote(
                    error.code === "same_password"
                      ? "Escolha uma senha diferente da atual."
                      : error.code === "weak_password"
                        ? "A senha não atende aos requisitos de segurança. Use uma senha mais forte."
                        : error.code === "invalid_credentials"
                          ? "Confira sua senha atual e tente novamente."
                          : "Não foi possível alterar a senha. Confira a senha atual ou use a recuperação pelo login.",
                  );
                  return;
                }
                form.reset();
                setNeedsCode(false);
                setPasswordNote("Senha alterada com sucesso.");
              } catch {
                setPasswordNote(
                  "Não foi possível alterar a senha. Tente novamente.",
                );
              } finally {
                setPasswordBusy(false);
              }
            }}
          >
            <label>
              Senha atual
              <input
                type="password"
                name="current"
                autoComplete="current-password"
                maxLength={128}
              />
              <small className="field-hint">
                Se sua conta foi criada com Google e ainda não tem senha, deixe
                em branco para definir uma.
              </small>
            </label>
            <label>
              Nova senha
              <input
                type="password"
                name="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirmar nova senha
              <input
                type="password"
                name="confirm"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            {needsCode && (
              <div className="profile-verification">
                <button
                  type="button"
                  className="text-button"
                  disabled={passwordBusy}
                  onClick={async () => {
                    setPasswordBusy(true);
                    try {
                      const { error } =
                        await createClient().auth.reauthenticate();
                      setPasswordNote(
                        error
                          ? "Não foi possível enviar o código. Aguarde e tente novamente."
                          : "Código enviado para seu e-mail.",
                      );
                    } catch {
                      setPasswordNote("Não foi possível enviar o código.");
                    } finally {
                      setPasswordBusy(false);
                    }
                  }}
                >
                  Enviar código de verificação
                </button>
                <label>
                  Código recebido
                  <input
                    name="nonce"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={32}
                  />
                </label>
              </div>
            )}
            <button className="secondary" disabled={passwordBusy}>
              {passwordBusy ? "Salvando…" : "Alterar senha"}
            </button>
            {passwordNote && (
              <p role="status" className="profile-message">
                {passwordNote}
              </p>
            )}
          </form>
        </section>
      </div>
      <p className="profile-shared-note">
        Foto, nome e nome de usuário personalizam seu perfil no Nossa Conta. O
        e-mail e a senha pertencem à sua conta de acesso compartilhada com o
        Juntô: alterações também valem para entrar lá. Seus lançamentos e
        pagamentos anteriores são preservados.
      </p>
    </main>
  );
}
