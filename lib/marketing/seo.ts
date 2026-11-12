import type { Metadata } from "next";
export const siteUrl = "https://nossaconta.unodev.com.br";
export function publicMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: siteUrl + path,
      siteName: "Nossa Conta",
      locale: "pt_BR",
      type: "website",
      images: [
        {
          url: "/images/planning-together.webp",
          width: 1200,
          height: 800,
          alt: "Organize as finanças juntos com o Nossa Conta",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/images/planning-together.webp"],
    },
  };
}
