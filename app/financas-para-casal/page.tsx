import Audience from "@/components/marketing/audience";
import { publicMetadata } from "@/lib/marketing/seo";
export const metadata = publicMetadata(
  "App de finanças para casal | Nossa Conta",
  "Organize os gastos do casal com acessos individuais, receitas, despesas, parcelas e previsão do mês. Conheça o Nossa Conta e comecem juntos.",
  "/financas-para-casal",
);
export default function Page() {
  return <Audience />;
}
