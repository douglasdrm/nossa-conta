import { z } from "zod";
import { installmentAmounts, installmentDate } from "./finance";
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const dateSchema = z
  .string()
  .regex(/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v,
    "Data inválida",
  );
const label = (max: number) => z.string().trim().min(1).max(max);
export const entrySchema = z.object({
  kind: z.enum(["income", "expense"]),
  description: label(120),
  amount: z.number().int().positive().max(1_000_000_000),
  category: label(60),
  person: label(60),
  date: dateSchema,
  repeats: z.boolean().optional().default(false),
  confirmed: z.boolean().optional().default(false),
  payer: label(60).optional(),
});
export const editSchema = z.object({
  id: z.string().min(1).max(100),
  description: label(120),
  amount: z.number().int().positive().max(1_000_000_000),
  category: label(60),
  person: label(60),
  date: dateSchema,
  future: z.boolean().optional().default(false),
  confirmed: z.boolean().optional(),
  payer: label(60).optional(),
});
export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
});
export function safeNext(value: string | null) {
  return value && /^\/(?!\/)/.test(value) && !/[\\\r\n]/.test(value)
    ? value
    : "/";
}

export const installmentSchema = entrySchema
  .and(
    z.object({
      installmentCount: z.number().int().min(2).max(120),
      installmentMode: z.enum(["total", "per_installment"]),
      installmentGroup: z.string().uuid(),
    }),
  )
  .superRefine((v, ctx) => {
    if (v.kind !== "expense" || v.repeats)
      ctx.addIssue({
        code: "custom",
        message: "Parcelamento é exclusivo para gastos não recorrentes",
      });
    if (!installmentAmounts(v.amount, v.installmentCount, v.installmentMode))
      ctx.addIssue({
        code: "custom",
        message: "Confira o valor e a quantidade de parcelas",
      });
    if (
      dateSchema.safeParse(v.date).success &&
      v.installmentCount >= 2 &&
      v.installmentCount <= 120 &&
      installmentDate(v.date, v.installmentCount - 1) >= "2100-01-01"
    )
      ctx.addIssue({
        code: "custom",
        message: "A última parcela precisa vencer antes de 2100",
      });
  });
