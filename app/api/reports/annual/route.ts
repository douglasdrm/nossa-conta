import type { PaymentMethod } from "@/lib/payment-methods";
import { authenticated, failure, ApiError } from "@/lib/api";
import { dateInSaoPaulo } from "@/lib/finance";
import {
  annualPeriods,
  addSpendingEntry,
  emptySpendingTotals,
  type SpendingTotals,
  annualTotals,
  monthlyPeriods,
} from "@/lib/finance-reports";
import { monthSchema } from "@/lib/validation";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { db } = await authenticated();
    const today = dateInSaoPaulo();
    const params = new URL(request.url).searchParams;
    const selected = params.get("year") ?? "";
    const month = params.get("month");
    const year = Number(selected);
    if (!/^20\d{2}$/.test(selected) || year > Number(today.slice(0, 4))) {
      throw new ApiError("Selecione um ano válido.", 400);
    }

    if (
      month !== null &&
      (!monthSchema.safeParse(month).success ||
        month.slice(0, 4) !== selected ||
        month > today.slice(0, 7))
    ) {
      throw new ApiError("Selecione um mês válido.", 400);
    }

    const yearPeriod = annualPeriods(year, today).current;
    const periods = month ? monthlyPeriods(month) : annualPeriods(year, today);
    const category = params.get("category");
    if (category !== null) {
      if (!category.trim() || category.length > 60)
        throw new ApiError("Selecione uma categoria válida.", 400);
      const period =
        params.get("period") === "previous"
          ? periods.previous
          : periods.current;
      const entries: {
        id: string;
        description: string;
        payment_method: PaymentMethod | null;
        amount: number;
        date: string;
      }[] = [];
      let cursor: string | undefined;
      for (;;) {
        let query = db
          .from("nc_entries")
          .select("id,description,amount,date,payment_method")
          .eq("kind", "expense")
          .eq("confirmed", true)
          .is("deleted_at", null)
          .eq("category", category)
          .gte("date", period.start)
          .lte("date", period.end)
          .order("id")
          .limit(500);
        if (cursor !== undefined) query = query.gt("id", cursor);
        const { data, error } = await query;
        if (error) throw error;
        entries.push(...data);
        if (data.length < 500) break;
        cursor = data[data.length - 1].id;
      }
      entries.sort(
        (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
      );
      return Response.json(
        { entries, period },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const monthTotals = new Map<string, SpendingTotals>();
    if (month) {
      for (let n = 1; n <= Number(yearPeriod.end.slice(5, 7)); n++) {
        monthTotals.set(
          `${year}-${String(n).padStart(2, "0")}`,
          emptySpendingTotals(),
        );
      }
    }

    async function spendingTotals(
      {
        start,
        end,
      }: {
        start: string;
        end: string;
      },
      includeMonthTotals = false,
    ) {
      const totals = emptySpendingTotals();
      let cursor: string | undefined;
      for (;;) {
        let query = db
          .from("nc_entries")
          .select("id,category,amount,date,payment_method,confirmed")
          .eq("kind", "expense")
          .is("deleted_at", null)
          .gte("date", start)
          .lte("date", end)
          .order("id")
          .limit(500);
        if (cursor !== undefined) query = query.gt("id", cursor);
        const { data, error } = await query;
        if (error) throw error;
        for (const row of data) {
          if (includeMonthTotals) {
            const key = row.date.slice(0, 7);
            const monthly = monthTotals.get(key);
            if (monthly) addSpendingEntry(monthly, row);
            if (key !== month) continue;
          }
          addSpendingEntry(totals, row);
        }
        if (data.length < 500) return totals;
        cursor = data[data.length - 1].id;
      }
    }

    const [current, previous] = await Promise.all([
      spendingTotals(month ? yearPeriod : periods.current, month !== null),
      spendingTotals(periods.previous),
    ]);
    return Response.json(
      {
        periods,
        ...annualTotals(current.categories, previous.categories),
        pendingTotal: current.pending,
        previousPendingTotal: previous.pending,
        expenseCount: current.count,
        previousExpenseCount: previous.count,
        paidCount: current.paidCount,
        previousPaidCount: previous.paidCount,
        paymentMethods: [...current.paymentMethods]
          .map(([method, total]) => ({ method, total }))
          .sort((a, b) => b.total - a.total),
        ...(month
          ? {
              months: [...monthTotals].map(([month, totals]) => ({
                month,
                total: totals.paid,
                pending: totals.pending,
                count: totals.count,
              })),
            }
          : {}),
      },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
