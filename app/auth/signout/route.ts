import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/api";
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const db = await createClient();
    await db.auth.signOut();
    return NextResponse.redirect(new URL("/login", r.url), 303);
  } catch (e) {
    return failure(e);
  }
}
