import { authenticated, checkOrigin, failure, ApiError } from "@/lib/api";
import { z } from "zod";
export const dynamic = "force-dynamic";
const group = z.enum(["essentials", "future", "leisure", "development"]);
const categorySchema = z
  .object({
    kind: z.enum(["income", "expense"]),
    name: z.string().trim().min(1).max(60),
    group: group.nullish(),
  })
  .refine(({ kind, group }) => (kind === "expense" ? Boolean(group) : !group));
export async function GET() {
  try {
    const { db } = await authenticated();
    const { data, error } = await db
      .from("nc_categories")
      .select("kind,name")
      .order("name");
    if (error) throw error;
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const { db } = await authenticated();
    const parsed = categorySchema.safeParse(await r.json());
    if (!parsed.success)
      throw new ApiError(
        "Informe um nome de até 60 caracteres e escolha o grupo financeiro para despesas.",
        400,
      );
    const { data, error } = await db.rpc("nc_add_category", {
      p_kind: parsed.data.kind,
      p_name: parsed.data.name,
      p_budget_group: parsed.data.group ?? null,
    });
    if (error)
      throw new ApiError(
        "Não foi possível criar a categoria. Tente novamente.",
        400,
      );
    return Response.json(data, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
