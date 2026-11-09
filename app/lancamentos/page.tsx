import FinanceSpace from "@/components/finance-space";
import { monthSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string | string[] }>;
}) {
  const month = monthSchema.safeParse((await searchParams).mes);
  return (
    <FinanceSpace
      view="entries"
      initialMonth={month.success ? month.data : undefined}
    />
  );
}
