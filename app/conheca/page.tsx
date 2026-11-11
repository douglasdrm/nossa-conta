import LandingPage from "@/components/landing-page";
export const metadata = {
  title: "Nossa Conta • Mais planos juntos",
  description:
    "Organize receitas, despesas e metas da casa em um espaço compartilhado. Conheça o Nossa Conta.",
  robots: { index: true, follow: true },
};
export default function PresentationPage() {
  return <LandingPage />;
}
