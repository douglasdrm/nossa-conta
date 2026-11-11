"use client";

import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallApp() {
  const prompt = useRef<InstallEvent | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState("other");

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const sync = () => setVisible(!media.matches && !(navigator as Navigator & { standalone?: boolean }).standalone);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      prompt.current = event as InstallEvent;
      sync();
    };
    const installed = () => {
      prompt.current = null;
      setVisible(false);
      dialog.current?.close();
    };
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setPlatform(ios ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "other");
    sync();
    media.addEventListener("change", sync);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", installed);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  async function install() {
    const event = prompt.current;
    if (!event) { dialog.current?.showModal(); return; }
    prompt.current = null;
    setBusy(true);
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "accepted") setVisible(false);
    } catch {
      dialog.current?.showModal();
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;
  return (
    <div className="app-install">
      <button type="button" className="app-install-button" onClick={install} disabled={busy}>
        <Download size={17} aria-hidden="true" /> {busy ? "Abrindo…" : "Instalar app"}
      </button>
      <dialog ref={dialog} className="app-install-dialog" aria-labelledby="install-title" onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <button type="button" className="app-install-close" aria-label="Fechar" onClick={() => dialog.current?.close()}><X size={20} /></button>
        <img src="/icons/nc-apple-touch-icon.png?v=2" width="64" height="64" alt="" />
        <h2 id="install-title">Nossa Conta sempre à mão</h2>
        <p>Adicione o app à sua tela inicial para abrir suas finanças com um toque.</p>
        {platform === "ios" ? (
          <p>No Safari, toque em <strong>Compartilhar</strong>, escolha <strong>Adicionar à Tela de Início</strong> e confirme em <strong>Adicionar</strong>. Se estiver em outro navegador, abra este endereço no Safari.</p>
        ) : platform === "android" ? (
          <p>No Chrome, abra o menu <strong>⋮</strong> e escolha <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>. Caso a opção ainda não apareça, navegue um pouco pelo site e tente novamente.</p>
        ) : (
          <p>No Chrome ou Edge, procure o ícone de instalação na barra de endereços ou a opção <strong>Instalar</strong> no menu do navegador. No Safari do Mac, use <strong>Arquivo → Adicionar ao Dock</strong>.</p>
        )}
        <p className="app-install-note">O app usa a mesma conta e precisa de internet para consultar e salvar os dados.</p>
        <button type="button" className="app-install-button" onClick={() => dialog.current?.close()}>Entendi</button>
      </dialog>
    </div>
  );
}
