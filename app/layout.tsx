import "./globals.css";
export const metadata = {
  title: "Nossa Conta • Finanças em conjunto",
  description: "Um lugar para entender e organizar as finanças da casa.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
