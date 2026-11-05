"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig, authCookieOptions } from "./config";
export function createClient() {
  const { url, key } = supabaseConfig();
  return createBrowserClient(url, key, { cookieOptions: authCookieOptions });
}
