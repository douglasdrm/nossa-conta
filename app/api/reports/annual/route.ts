import { authenticated, failure, ApiError } from "@/lib/api";
import { dateInSaoPaulo } from "@/lib/finance";
import { annualPeriods, annualTotals } from "@/lib/finance-reports";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await authenticated();
    const today = dateInSaoPaulo();
    const selected = new URL(request.url).searchParams.get("year") ?? "";
    const year = Number(selected);
    if (!/^20\d{2}$/.test(selected) || year > Number(today.slice(0, 4))) {
      throw new ApiError("Selecione um ano válido.", 400);
    }

    async function categoryTotals({
      start,
      end,
    }: {
      start: string;
      end: string;
    }) {
      const totals = new Map<string, number>();
      let cursor: string | undefined;
      for (;;) {
        let query = db
          .from("nc_entries")
          .select("id,category,amount")
          .eq("kind", "expense")
          .eq("confirmed", true)
          .is("deleted_at", null)
          .gte("date", start)
          .lte("date", end)
          .order("id")
          .limit(500);
        if (cursor !== undefined) query = query.gt("id", cursor);
        const { data, error } = await query;
        if (error) throw error;
        for (const row of data)
          totals.set(
            row.category,
            (totals.get(row.category) ?? 0) + row.amount,
          );
        if (data.length < 500) return totals;
        cursor = data[data.length - 1].id;
      }
    }

    const periods = annualPeriods(year, today);
    const [current, previous] = await Promise.all([
      categoryTotals(periods.current),
      categoryTotals(periods.previous),
    ]);
    return Response.json(
      { periods, ...annualTotals(current, previous) },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
