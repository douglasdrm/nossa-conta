import Audience from "@/components/marketing/audience";
import { publicMetadata } from "@/lib/marketing/seo";
export const metadata = publicMetadata(
  "Controle financeiro familiar | Nossa Conta",
  "Organize as contas da casa: receitas, despesas, parcelas e vencimentos em um espaço compartilhado. Saiba quem pagou e acompanhe o orçamento familiar.",
  "/controle-financeiro-familiar",
);
export default function Page() {
  return <Audience family />;
}
