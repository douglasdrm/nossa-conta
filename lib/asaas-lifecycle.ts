import { z } from "zod";

export const monitoredAsaasEvents = [
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_UPDATED",
  "SUBSCRIPTION_INACTIVATED",
  "SUBSCRIPTION_DELETED",
] as const;

const notification = z.object({
  id: z.string().min(3).max(250),
  event: z.string(),
  payment: z.object({
    id: z.string().min(3).max(150),
    subscription: z.string().min(3).max(150).nullish(),
    value: z.number().positive().finite(),
  }).optional(),
  subscription: z.object({
    id: z.string().min(3).max(150),
  }).optional(),
});

export function sandboxLifecycleNotification(input: unknown) {
  const parsed = notification.safeParse(input);
  if (!parsed.success) return null;
  const e = parsed.data;
  if (!(monitoredAsaasEvents as readonly string[]).includes(e.event)) return null;
  if (e.event.startsWith("PAYMENT_")) {
    if (!e.payment?.subscription) return null;
    const amount = Math.round(e.payment.value * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) return null;
    return {
      id: e.id, type: e.event, resource: "payment" as const,
      resourceId: e.payment.id, subscriptionId: e.payment.subscription,
      amount,
    };
  }
  if (!e.subscription) return null;
  return {
    id: e.id, type: e.event, resource: "subscription" as const,
    resourceId: e.subscription.id, subscriptionId: e.subscription.id,
    amount: null,
  };
}
