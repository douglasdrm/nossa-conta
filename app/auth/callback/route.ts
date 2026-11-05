import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validation";
export async function GET(request: Request) {
  const url = new URL(request.url),
    code = url.searchParams.get("code"),
    next = safeNext(url.searchParams.get("next"));
  if (code) {
    const db = await createClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", url.origin),
  );
}
