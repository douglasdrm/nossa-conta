import { z } from "zod";
import type { createClient } from "./supabase/server";

const accessSchema = z.object({
  kind: z.enum(["free", "trial", "paid", "courtesy", "admin"]),
  premium: z.boolean(),
  can_access: z.boolean(),
  is_owner: z.boolean(),
  trial_until: z.string().nullable(),
  valid_until: z.string().nullable(),
});

export type AccountAccess = z.infer<typeof accessSchema>;

export async function readAccountAccess(db: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await db.rpc("nc_access_status");
  if (error) throw error;
  return accessSchema.parse(data);
}
