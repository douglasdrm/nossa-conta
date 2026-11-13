import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { asaas, sandboxConfig, verifiedCheckoutStatus } from "@/lib/asaas";
import { recordResult, recordSandboxLifecycleEvent, applySandboxRenewal } from "@/lib/billing-server";
import { sandboxLifecycleNotification } from "@/lib/asaas-lifecycle";
import { verifiedSandboxRenewalPayment } from "@/lib/asaas-renewal-verification";
import type { AsaasCharge } from "@/lib/asaas-renewal-reconciliation";
export const runtime = "nodejs";
const eventSchema = z.object({
  id: z.string().min(1).max(250),
  event: z.enum([
    "CHECKOUT_PAID",
    "CHECKOUT_CANCELED",
    "CHECKOUT_EXPIRED",
    "CHECKOUT_CREATED",
  ]),
  checkout: z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{10,100}$/),
    status: z.enum(["ACTIVE", "PAID", "CANCELED", "EXPIRED"]),
    externalReference: z.string().uuid().nullish(),
    items: z
      .array(
        z.object({
          value: z.number().positive(),
          quantity: z.number().int().positive(),
        }),
      )
      .min(1),
  }),
});
export async function POST(request: Request) {
  try {
    const expected = Buffer.from(sandboxConfig().token),
      received = Buffer.from(request.headers.get("asaas-access-token") || "");
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    const raw = await request.text();
    if (raw.length > 64000)
      return Response.json({ error: "Too large" }, { status: 413 });
    const body = JSON.parse(raw);
    if (typeof body?.event === "string" && !body.event.startsWith("CHECKOUT_")) {
      const lifecycle = sandboxLifecycleNotification(body);
      if (lifecycle) {
        const matched = await recordSandboxLifecycleEvent(lifecycle);
        // Shared Asaas account: never query or credit unlinked subscriptions.
        // An authenticated webhook event is a signal, NOT proof of settlement.
        if (matched && lifecycle.resource === "payment" &&
            ["PAYMENT_CONFIRMED","PAYMENT_RECEIVED"].includes(lifecycle.type)) {
          const providerCharge = await asaas<AsaasCharge>(
            "/payments/" + encodeURIComponent(lifecycle.resourceId)
          );
          const verified = verifiedSandboxRenewalPayment(
            lifecycle.resourceId, lifecycle.subscriptionId, providerCharge,
          );
          if (verified && verified.amount === lifecycle.amount) {
            await applySandboxRenewal(verified);
          }
        }
      }
      // Unlinked events can belong to other products on the same Asaas account.
      return Response.json({ received: true });
    }
    const parsed = eventSchema.safeParse(body);
    if (!parsed.success)
      return Response.json({ error: "Invalid event" }, { status: 400 });
    const event = parsed.data,
      checkout = event.checkout;
    const total = Math.round(
      checkout.items.reduce((s, i) => s + i.value * i.quantity, 0) * 100,
    );
    const reference = checkout.externalReference || "provider-event";
    const status = verifiedCheckoutStatus(
      { ...checkout, externalReference: reference },
      reference,
      total,
    );
    // Match the provider ID already recorded by creation; unknown IDs never create orders.
    await recordResult(
      checkout.externalReference ?? null,
      checkout.id,
      status,
      event.id,
      total,
    );
    return Response.json({ received: true });
  } catch {
    return Response.json(
      { error: "Webhook could not be processed" },
      { status: 503 },
    );
  }
}
