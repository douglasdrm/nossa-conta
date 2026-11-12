import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sandboxConfig, verifiedCheckoutStatus } from "@/lib/asaas";
import { recordResult } from "@/lib/billing-server";
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
    const parsed = eventSchema.safeParse(JSON.parse(raw));
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
