import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/marketing/seo";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/assinatura",
        "/login",
        "/auth/",
        "/profile",
        "/invite",
        "/reset-password",
        "/lancamentos",
        "/caixinhas",
        "/categorias",
        "/plano-do-mes",
        "/relatorio-anual",
      ],
    },
    sitemap: siteUrl + "/sitemap.xml",
    host: siteUrl,
  };
}
