import { z } from "zod";
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
export const entrySchema = z
  .object({
    kind: z.enum(["income", "expense"]),
    description: label(120),
    amount: z.number().int().positive().max(1_000_000_000),
    category: label(60),
    person: label(60),
    date: dateSchema,
    repeats: z.boolean().optional().default(false),
  })
  .refine(
    (v) => !v.repeats || v.kind === "expense",
    "Somente despesas podem ser recorrentes",
  );
export const editSchema = z.object({
  id: z.string().min(1).max(100),
  description: label(120),
  amount: z.number().int().positive().max(1_000_000_000),
  category: label(60),
  person: label(60),
  date: dateSchema,
  future: z.boolean().optional().default(false),
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
