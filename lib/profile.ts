import { profileColors } from "./visual-colors";
import { z } from "zod";
export const profileSchema = z.object({
  color: z.enum(profileColors).nullish(),
  name: z.string().trim().min(1).max(60),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => !v || /^[a-z0-9_]{3,30}$/.test(v)),
});
export const avatarLimit = 3 * 1024 * 1024;
