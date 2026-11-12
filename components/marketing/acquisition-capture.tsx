"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { attributionKey, readAttribution } from "@/lib/marketing/attribution";
const publicPaths = [
  "/conheca",
  "/planos",
  "/financas-para-casal",
  "/controle-financeiro-familiar",
];
export default function AcquisitionCapture({
  register = false,
}: {
  register?: boolean;
}) {
  const path = usePathname();
  useEffect(() => {
    try {
      if (!localStorage.getItem(attributionKey)) {
        const params = new URLSearchParams(location.search);
        let source = "direct",
          medium = "";
        if (params.get("utm_source")) {
          source = params.get("utm_source")!;
          medium = params.get("utm_medium") || "";
        } else if (document.referrer) {
          try {
            const ref = new URL(document.referrer);
            if (ref.origin !== location.origin) {
              source = ref.hostname;
              medium = /google\./i.test(ref.hostname) ? "organic" : "referral";
            }
          } catch {}
        }
        const landing =
          path === "/" ||
          publicPaths.includes(path) ||
          path.startsWith("/guias/")
            ? path
            : "/";
        localStorage.setItem(
          attributionKey,
          JSON.stringify({
            source: source.slice(0, 120),
            medium: medium.slice(0, 120),
            campaign: (params.get("utm_campaign") || "").slice(0, 120),
            landing,
          }),
        );
      }
    } catch {} // The app remains usable when storage is blocked.
    if (!register) return;
    if (
      path.startsWith("/auth/") ||
      path === "/login" ||
      publicPaths.includes(path) ||
      path.startsWith("/guias/")
    )
      return;
    const controller = new AbortController();
    fetch("/api/acquisition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readAttribution()),
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
  }, [path, register]);
  return null;
}
