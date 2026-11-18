import { z } from "zod";
import { installmentDate } from "./finance";
export type CreditCard = { id: string; name: string; due_day: number; closing_day: number; closing_estimated: boolean; archived: boolean };
export const creditCardSchema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(60), dueDay: z.number().int().min(1).max(31), closingDay: z.number().int().min(1).max(31), closingEstimated: z.boolean().default(false), archived: z.boolean().default(false) });
export const suggestedClosingDay = (due: number) => ((due - 8 + 31) % 31) + 1;
export function cardDay(month: string, day: number) {
  return installmentDate(month + "-01", 0).slice(0, 8) + String(Math.min(day, new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate())).padStart(2, "0");
}
export function firstInvoiceMonth(purchase: string, closingDay: number, dueDay: number) {
  let month = purchase.slice(0, 7);
  if (purchase > cardDay(month, closingDay)) month = installmentDate(month + "-01", 1).slice(0, 7);
  if (dueDay <= closingDay) month = installmentDate(month + "-01", 1).slice(0, 7);
  return month;
}
export const cardErrorMessage = (message?: string) => ({
  invoice_paid: "Esta fatura já foi paga. Reabra a fatura em Cartões antes de corrigir suas compras.",
  pay_invoice_instead: "Esta compra pertence a uma fatura. Confirme o pagamento pela área Cartões.",
  card_not_found: "Selecione um cartão ativo do seu espaço.",
  card_link_required: "Mantenha o cartão vinculado a esta compra.",
  keep_invoice_month: "Escolha um vencimento dentro do mês desta fatura.",
  invalid_card_purchase: "Use uma compra única ou parcelada para vincular ao cartão. Recorrências antigas continuam sem vínculo.",
  premium_required: "Parcelamentos fazem parte do Premium. Seus dados continuam guardados.",
}[message ?? ""] ?? "Não foi possível salvar. Confira os dados e tente novamente.");
