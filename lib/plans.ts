export const billingCycles = ["monthly", "quarterly", "yearly"] as const;
export type BillingCycle = (typeof billingCycles)[number];
export const plans = [
  {
    id: "monthly",
    name: "Mensal",
    months: 1,
    total: 1490,
    monthly: 1490,
    saving: 0,
    period: "por mês",
  },
  {
    id: "quarterly",
    name: "Trimestral",
    months: 3,
    total: 3870,
    monthly: 1290,
    saving: 600,
    period: "a cada 3 meses",
  },
  {
    id: "yearly",
    name: "Anual",
    months: 12,
    total: 11880,
    monthly: 990,
    saving: 6000,
    period: "por ano",
  },
] as const;
export const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export const premiumFeatures = [
  "Uma assinatura para o espaço compartilhado",
  "Receitas, despesas e identificação de quem pagou",
  "Compras parceladas e contas recorrentes",
  "Previsão mensal, relatórios e Caixinhas",
];
