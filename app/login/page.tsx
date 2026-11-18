import { Suspense } from "react";
import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validation";
import Setup from "@/components/setup";
import LoginForm from "./login-form";
export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!isConfigured()) return <Setup />;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (user && !user.is_anonymous && user.email_confirmed_at) {
    const { next } = await searchParams;
    redirect(safeNext(next ?? null));
  }
  return (
    <Suspense fallback={<p>Carregando...</p>}>
      <LoginForm />
    </Suspense>
  );
}

