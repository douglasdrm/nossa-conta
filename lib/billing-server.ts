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
