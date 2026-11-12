import { notFound } from "next/navigation";
import MarketingFrame from "@/components/marketing/frame";
import { guides } from "@/lib/marketing/guides";
import { publicMetadata } from "@/lib/marketing/seo";
export function generateStaticParams() {
  return Object.keys(guides).map((slug) => ({ slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = guides[slug];
  return guide
    ? publicMetadata(
        guide.title + " | Nossa Conta",
        guide.description,
        "/guias/" + slug,
      )
    : { robots: { index: false, follow: false } };
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = guides[slug];
  if (!guide) notFound();
  return (
    <MarketingFrame>
      <article>
        <header className="seo-intro">
          <span className="marketing-eyebrow">
            GUIAS DO NOSSA CONTA · EQUIPE UNODEV
          </span>
          <h1>{guide.title}</h1>
          <p>{guide.intro}</p>
        </header>
        <div className="seo-copy">
          {guide.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.text}</p>
            </section>
          ))}
          <div className="seo-actions">
            <a className="marketing-cta" href="/login?mode=signup">
              Experimentar o Nossa Conta
            </a>
            <a href="/planos">Ver planos e preços</a>
          </div>
          <nav className="seo-links" aria-label="Guias relacionados">
            {Object.entries(guides)
              .filter(([key]) => key !== slug)
              .map(([key, item]) => (
                <a key={key} href={"/guias/" + key}>
                  {item.title}
                </a>
              ))}
          </nav>
        </div>
      </article>
    </MarketingFrame>
  );
}
