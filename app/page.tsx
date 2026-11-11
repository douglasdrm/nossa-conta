import LandingPage from "@/components/landing-page";
import FinanceSpace from "@/components/finance-space";

export const dynamic = "force-dynamic";

export default function Page() {
  return <FinanceSpace guest={<LandingPage />} />;
}
