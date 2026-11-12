import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isConfigured,
  supabaseConfig,
  authCookieOptions,
} from "./lib/supabase/config";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const publicPaths = [
    "/",
    "/conheca",
    "/robots.txt",
    "/sitemap.xml",
    "/planos",
    "/financas-para-casal",
    "/controle-financeiro-familiar",
  ];
  const isPublic =
    publicPaths.includes(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith("/guias/");
  if (!isPublic) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  // Marketing pages do not need session refresh and can keep their static caching.
  if ((isPublic && request.nextUrl.pathname !== "/") || !isConfigured())
    return response;
  const { url, key } = supabaseConfig();
  const supabase = createServerClient(url, key, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, cacheHeaders) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(cacheHeaders ?? {}).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });
  // Never authorize with getSession(): verify the JWT on every request.
  const { data } = await supabase.auth.getClaims();
  if (!isPublic || (request.nextUrl.pathname === "/" && data?.claims?.sub))
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
