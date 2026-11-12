import Brand from "@/components/brand";
import "@/components/landing-page.css";
export default function MarketingFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="marketing">
      <header className="marketing-header">
        <a href="/conheca" aria-label="Nossa Conta — apresentação">
          <Brand />
        </a>
        <nav aria-label="Navegação">
          <a href="/financas-para-casal">Para casais</a>
          <a href="/controle-financeiro-familiar">Para famílias</a>
          <a href="/planos">Planos</a>
        </nav>
        <a className="marketing-login" href="/login">
          Entrar
        </a>
      </header>
      <main className="marketing-main">{children}</main>
      <footer className="marketing-footer">
        <a href="/conheca">
          <Brand />
        </a>
        <a href="/guias/organizar-contas-do-casal">Guia do casal</a>
        <a href="/guias/controlar-compras-parceladas">Compras parceladas</a>
        <a href="/planos">Planos</a>
        <span>Desenvolvido pela UNODEV</span>
      </footer>
    </div>
  );
}
