import { z } from "zod";
import { billingCycles } from "./plans";
export const acquisitionSchema = z.object({
  source: z.string().trim().max(120).default("direct"),
  medium: z.string().trim().max(120).default(""),
  campaign: z.string().trim().max(120).default(""),
  landing: z
    .string()
    .max(200)
    .regex(/^\/(?!\/)[a-zA-Z0-9/_-]*$/)
    .default("/"),
  cycle: z.enum(billingCycles).optional(),
});
export const leadStages = {
  new: "Novo",
  contacted: "Em contato",
  interested: "Interessado",
  subscriber: "Assinante",
  closed: "Sem interesse",
} as const;
export const adminMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("lead"),
    id: z.string().uuid().nullable(),
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(40),
    stage: z.enum(["new", "contacted", "interested", "subscriber", "closed"]),
    notes: z.string().max(2000),
    source: z.string().trim().max(120).default("manual"),
  }),
  z.object({
    action: z.literal("courtesy"),
    household: z.string().uuid(),
    until: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(3).max(300),
  }),
]);
export type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  stage: keyof typeof leadStages;
  cycle: string | null;
  source: string;
  medium: string;
  campaign: string;
  landing_path: string;
  notes: string;
  created_at: string;
  interested_at: string | null;
};
export type AdminData = {
  summary: {
    users: number;
    households: number;
    leads: number;
    interested: number;
    courtesies: number;
    activated: number;
    accepted_invites: number;
  };
  leads: Lead[];
  lead_count: number;
  user_count: number;
  household_count: number;
  users: {
    id: string;
    email: string;
    name: string;
    created_at: string;
    household_id: string | null;
    activated: boolean;
  }[];
  households: {
    id: string;
    name: string;
    owner_email: string;
    members: number;
    status: string;
    valid_until: string | null;
    reason: string | null;
  }[];
  sources: { source: string; registrations: number; interested: number }[];
  audit: {
    action: string;
    target_id: string;
    created_at: string;
    actor: string;
  }[];
};
