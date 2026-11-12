import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/marketing/seo";
import { guides } from "@/lib/marketing/guides";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "/",
    "/planos",
    "/financas-para-casal",
    "/controle-financeiro-familiar",
    ...Object.keys(guides).map((slug) => "/guias/" + slug),
  ].map((path) => ({ url: siteUrl + path }));
}
