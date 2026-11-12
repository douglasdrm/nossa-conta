export const attributionKey = "nc-first-touch-v1";
export type Attribution = {
  source: string;
  medium: string;
  campaign: string;
  landing: string;
};
export function readAttribution(): Attribution {
  try {
    const parsed = JSON.parse(localStorage.getItem(attributionKey) || "null");
    if (parsed && typeof parsed.source === "string")
      return {
        source: parsed.source.slice(0, 120),
        medium: String(parsed.medium || "").slice(0, 120),
        campaign: String(parsed.campaign || "").slice(0, 120),
        landing:
          typeof parsed.landing === "string" &&
          /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(parsed.landing)
            ? parsed.landing.slice(0, 200)
            : "/",
      };
  } catch {
    /* Storage unavailable: use direct source. */
  }
  return { source: "direct", medium: "", campaign: "", landing: "/" };
}
