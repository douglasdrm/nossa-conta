import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Production webhook authToken validation on the server ONLY.
 * This never accepts the Asaas production API key as a substitute.
 * Do not expose this function or its arguments to client components.
 */
export function matchesProductionWebhookToken(
  configuredToken: string | undefined,
  receivedHeader: string | null,
): boolean {
  if (!configuredToken || !receivedHeader ||
      configuredToken.length < 32 || configuredToken.length > 255 ||
      /\s/.test(configuredToken)) return false;
  const a=Buffer.from(configuredToken,"utf8");
  const b=Buffer.from(receivedHeader,"utf8");
  return a.length===b.length && timingSafeEqual(a,b);
}
