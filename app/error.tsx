"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Não foi possível abrir agora.</h1>
        <p>
          Tente novamente. Se esta for a primeira instalação, confirme se a
          migração do banco foi aplicada.
        </p>
        <button className="primary" onClick={reset}>
          Tentar novamente
        </button>
        <a href="/login" className="text-button">
          Ir para o login
        </a>
      </section>
    </main>
  );
}
