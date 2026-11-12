import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/api";
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const form = await r.formData();
    const destination =
      form.get("next") === "/admin/login" ? "/admin/login" : "/login";
    const db = await createClient();
    const { error } = await db.auth.signOut({ scope: "local" });
    if (error) throw error;
    return NextResponse.redirect(new URL(destination, r.url), 303);
  } catch (e) {
    return failure(e);
  }
}
