import { publicMetadata } from "@/lib/marketing/seo";
import LandingPage from "@/components/landing-page";
export const metadata = publicMetadata(
  "Nossa Conta — Controle financeiro para casais e famílias",
  "Organize receitas, despesas, parcelas e metas com quem divide as contas com você. Conheça o Nossa Conta e acompanhem juntos o orçamento do mês.",
  "/",
);
export default function PresentationPage() {
  return <LandingPage />;
}
