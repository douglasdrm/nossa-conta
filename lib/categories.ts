export const expenseCategories = [
  "Mercado",
  "Moradia",
  "Alimentação",
  "Transporte",
  "Saúde",
  "Lazer",
  "Compras",
  "Educação",
  "Contas e serviços",
  "Outros",
];
export const incomeCategories = [
  "Salário",
  "Freelance",
  "Rendimentos",
  "Outras receitas",
];

export type CategoryItem = {
  kind: "expense" | "income";
  name: string;
  group: import("./budget-plan").BudgetGroup | null;
};
