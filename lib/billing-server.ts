import { createClient } from "@supabase/supabase-js";
import { authenticated, ApiError } from "./api";
import { supabaseConfig } from "./supabase/config";
import { sandboxConfig } from "./asaas";
export async function billingAdmin() {
  const session = await authenticated();
  const { data, error } = await session.db.rpc("nc_is_system_admin");
  if (
    error ||
    data !== true ||
    session.user.is_anonymous ||
    !session.user.email_confirmed_at
  )
    throw new ApiError("Acesso restrito aos administradores.", 403);
  return session;
}
export function billingDb() {
  const { url, key } = supabaseConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function recordResult(
  order: string | null,
  checkout: string | null,
  status: string,
  event?: string,
  amount?: number,
) {
  const { data, error } = await billingDb().rpc("nc_billing_result", {
    p_token: sandboxConfig().token,
    p_order: order,
    p_checkout: checkout,
    p_status: status,
    p_event: event ?? null,
    p_amount: amount ?? null,
  });
  if (error || data !== true)
    throw new Error("Não foi possível registrar o resultado do checkout.");
}

/**
 * Link a recurring Asaas subscription only after the admin sync verifies
 * a paid checkout and a matching payment from that exact checkout.
 */
export async function linkSandboxSubscription(order: string, checkout: string, subscription: string) {
  const { data, error } = await billingDb().rpc("nc_billing_link_subscription", {
    p_token: sandboxConfig().token,
    p_order: order,
    p_checkout: checkout,
    p_subscription: subscription,
  });
  if (error || data !== true) throw new Error("Não foi possível vincular a assinatura de teste.");
}

/** Sandbox audit only: never changes a Premium entitlement or courtesy. */
export async function recordSandboxLifecycleEvent(event: {
  id: string;
  type: string;
  resource: "payment" | "subscription";
  resourceId: string;
  subscriptionId: string;
  amount: number | null;
}) {
  const { data, error } = await billingDb().rpc("nc_billing_lifecycle_event", {
    p_token: sandboxConfig().token,
    p_event_id: event.id,
    p_resource: event.resource,
    p_resource_id: event.resourceId,
    p_subscription: event.subscriptionId,
    p_event_type: event.type,
    p_amount: event.amount,
  });
  if (error) throw new Error("Não foi possível registrar o evento de cobrança de teste.");
  return data === true;
}

/** Atomic, token-gated Sandbox renewal. The webhook only sends validated API data. */
export async function applySandboxRenewal(payment: {
  id: string; subscription: string; amount: number; dueDate: string; status: string;
}): Promise<string> {
  const { data, error } = await billingDb().rpc("nc_billing_apply_sandbox_renewal", {
    p_token: sandboxConfig().token,
    p_subscription: payment.subscription,
    p_payment: payment.id,
    p_amount: payment.amount,
    p_due_date: payment.dueDate,
    p_verified_status: payment.status,
  });
  if (error) throw new Error("Não foi possível conciliar a renovação de teste.");
  return data as string;
}
