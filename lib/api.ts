import { createClient } from "./supabase/server";
import { isConfigured } from "./supabase/config";
import { readAccountAccess } from "./access";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function authenticated() {
  if (!isConfigured())
    throw new ApiError(
      "O aplicativo ainda precisa ser conectado ao Supabase.",
      503,
    );
  const db = await createClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    throw new ApiError("Entre na sua conta para continuar.", 401);
  return { db, user: data.user };
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new ApiError("Origem não autorizada.", 403);
}
export async function authenticatedFinance(premium = false) {
  const session = await authenticated();
  const access = await readAccountAccess(session.db);
  if (!access.can_access)
    throw new ApiError("O compartilhamento deste espaço está pausado. Peça ao responsável para renovar o Premium.", 403);
  if (premium && !access.premium)
    throw new ApiError("Este recurso faz parte do Premium. Seus dados continuam guardados.", 403);
  return { ...session, access };
}

export function failure(error: unknown) {
  if (error && typeof error === "object" && "message" in error && error.message === "premium_required") {
    return Response.json({ error: "Este recurso faz parte do Premium. Seus dados continuam guardados." }, { status: 403 });
  }
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(
    "Request failed",
    error instanceof Error ? error.message : "Database operation failed",
  );
  return Response.json(
    { error: "Não foi possível concluir. Tente novamente." },
    { status: 500 },
  );
}

