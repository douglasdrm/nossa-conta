import "./globals.css";
import type { Metadata, Viewport } from "next";
import AcquisitionCapture from "@/components/marketing/acquisition-capture";
import InstallApp from "@/components/install-app";
export const viewport: Viewport = { themeColor: "#286653" };
export const metadata: Metadata = {
  metadataBase: new URL("https://nossaconta.unodev.com.br"),
  title: {
    default: "Nossa Conta — Finanças em conjunto",
    template: "%s | Nossa Conta",
  },
  description: "Um lugar para entender e organizar as finanças da casa.",
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION || undefined },
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
        <AcquisitionCapture />
        <InstallApp />
      </body>
    </html>
  );
}
