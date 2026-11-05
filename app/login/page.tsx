import { Suspense } from "react";
import { isConfigured } from "@/lib/supabase/config";
import Setup from "@/components/setup";
import LoginForm from "./login-form";
export default function Login() {
  if (!isConfigured()) return <Setup />;
  return (
    <Suspense fallback={<p>Carregando...</p>}>
      <LoginForm />
    </Suspense>
  );
}
