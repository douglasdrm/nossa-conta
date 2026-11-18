import Image from "next/image";
import { premiumFeatures } from "@/lib/plans";

export default function SubscriptionBenefits() {
  return (
    <div className="subscription-story">
      <Image src="/images/planning-together.webp"
        alt="Casal planejando as finanças juntos em casa"
        width={1200} height={800} priority
        sizes="(max-width: 850px) 100vw, 40vw"
        className="subscription-photo" />
      <section className="subscription-benefits" aria-labelledby="subscription-benefits-title">
        <span className="marketing-eyebrow">PARA ORGANIZAR A VIDA EM COMUM</span>
        <h2 id="subscription-benefits-title">Um plano para<br />o espaço de vocês.</h2>
        <ul>{premiumFeatures.map((feature) => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul>
      </section>
    </div>
  );
}
