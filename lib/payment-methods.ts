export const paymentMethods = [
  "pix",
  "cash",
  "credit_card",
  "debit_card",
  "bank_slip",
  "transfer",
  "other",
] as const;

export type PaymentMethod = (typeof paymentMethods)[number];

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  pix: "Pix",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  bank_slip: "Boleto",
  transfer: "Transferência",
  other: "Outra forma",
};
