import "./globals.css";
import type { Viewport } from "next";
import InstallApp from "@/components/install-app";
export const viewport: Viewport = { themeColor: "#286653" };
export const metadata = {
  title: "Nossa Conta • Finanças em conjunto",
  description: "Um lugar para entender e organizar as finanças da casa.",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg?v=nc2",
    apple: "/icons/nc-apple-touch-icon.png?v=2",
  },
  appleWebApp: {
    capable: true,
    title: "Nossa Conta",
    statusBarStyle: "default",
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <InstallApp />
      </body>
    </html>
  );
}
