import { authenticated, failure } from "@/lib/api";
import { dateInSaoPaulo } from "@/lib/finance";
import { historyMonths, radarPatterns, type RadarExpense } from "@/lib/radar";

export async function GET() {
  try {
    const { db } = await authenticated();
    const today = dateInSaoPaulo();
    const [start] = historyMonths(today);
    const { data: household, error: householdError } = await db
      .from("nc_households")
      .select("savings_buffer")
      .maybeSingle();
    if (householdError) throw householdError;

    const expenses: RadarExpense[] = [];
    let cursor: string | undefined;
    for (;;) {
      let query = db
        .from("nc_entries")
        .select("id,date,category,amount")
        .eq("kind", "expense")
        .eq("confirmed", true)
        .is("deleted_at", null)
        .gte("date", start + "-01")
        .lt("date", today.slice(0, 7) + "-01")
        .order("id")
        .limit(500);
      if (cursor !== undefined) query = query.gt("id", cursor);
      const { data, error } = await query;
      if (error) throw error;
      expenses.push(...data);
      if (data.length < 500) break;
      cursor = data[data.length - 1].id;
    }

    return Response.json(
      {
        buffer: household?.savings_buffer ?? 0,
        patterns: radarPatterns(today, expenses),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
