import CategoryName from "@/components/category-name";
import {
  budgetAmounts,
  budgetSpending,
  type BudgetPlan,
} from "@/lib/budget-plan";
import { Radar } from "lucide-react";
import type { monthForecast } from "@/lib/finance";
import {
  largestUnplannedExpense,
  type RadarExpense,
  type RadarPattern,
} from "@/lib/radar";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const money = (amount: number) => currency.format(amount / 100);

export default function RadarPanel({
  today,
  entries,
  totals,
  context,
  plan,
}: {
  today: string;
  entries: (RadarExpense & { kind: string; confirmed: boolean })[];
  totals: ReturnType<typeof monthForecast>;
  plan: BudgetPlan | null;
  context: { buffer: number; patterns: RadarPattern[] } | null;
}) {
  const { current, pending, pendingIncome, projected } = totals;
  const afterBills = current - pending;
  const buffer = context?.buffer ?? 0;
  const belowBuffer = buffer > 0 && afterBills >= 0 && afterBills < buffer;
  const estimate = largestUnplannedExpense(
    today,
    context?.patterns ?? [],
    entries.filter(({ kind }) => kind === "expense"),
  );

  const essentialsOver = plan?.enabled
    ? budgetSpending(entries, { ...plan.categoryGroups, ...plan.categories })
        .groups.essentials -
      budgetAmounts(totals.totalIncome, plan.shares).essentials
    : 0;

  return (
    <section className="month-radar" aria-labelledby="month-radar-title">
      <h2 id="month-radar-title">
        <Radar size={20} aria-hidden="true" /> Radar do mês
      </h2>
      <article
        className={
          afterBills < 0
            ? "radar-shortfall"
            : belowBuffer
              ? "radar-caution"
              : ""
        }
      >
        <h3>
          {afterBills < 0
            ? "O mês pode fechar no vermelho"
            : belowBuffer
              ? "Sobra abaixo da sua margem"
              : "Quanto sobra depois das contas"}
        </h3>
        <p>
          Com o que já entrou, o saldo do mês é{" "}
          <strong>{money(current)}</strong> e há{" "}
          <strong>{money(pending)}</strong> a pagar.{" "}
          {afterBills < 0 ? (
            <>
              Faltam <strong>{money(-afterBills)}</strong> para fechar o mês.
            </>
          ) : (
            <>
              Sobram <strong>{money(afterBills)}</strong> depois das contas
              lançadas.
            </>
          )}
          {belowBuffer && <> Sua margem nas caixinhas é de {money(buffer)}.</>}
          {pendingIncome > 0 && (
            <>
              {" "}
              Se entrarem os {money(pendingIncome)} previstos, o saldo após as
              contas fica em <strong>{money(projected)}</strong>.
            </>
          )}
        </p>
      </article>
      {essentialsOver > 0 ? (
        <article className="radar-caution">
          <h3>Essenciais acima do plano</h3>
          <p>
            As contas essenciais lançadas passaram{" "}
            <strong>{money(essentialsOver)}</strong> do valor planejado.{" "}
            <a href="/plano-do-mes">Ver plano do mês</a>
          </p>
        </article>
      ) : estimate ? (
        <article className="radar-caution">
          <h3>
            <CategoryName name={estimate.category} /> no restante do mês
          </h3>
          <p>
            Pelo histórico dos últimos 3 meses, vocês costumam gastar cerca de{" "}
            <strong>{money(estimate.typical)}</strong> nessa categoria entre o
            dia {Number(today.slice(8))} e o fim do mês. Descontando o que já
            está lançado para esse período e as contas em aberto da categoria, a
            estimativa é de <strong>{money(estimate.extra)} a mais</strong>.
          </p>
        </article>
      ) : null}
    </section>
  );
}
