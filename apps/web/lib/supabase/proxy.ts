import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const CACHE_HEADERS = ["cache-control", "expires", "pragma"] as const;

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  // Provider webhooks, runtime health probes and legal/App Review endpoints
  // must be reachable without an end-user Supabase session. Webhooks are
  // protected by provider signature; health routes expose no workspace data;
  // legal routes contain only deployment-level public information.
  if (
    pathname === "/api/providers/instagram/webhook" ||
    pathname.startsWith("/api/health/") ||
    pathname.startsWith("/legal/")
  ) {
    return NextResponse.next({ request });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return new NextResponse("Authentication is not configured.", { status: 503 });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

        supabaseResponse = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });

        for (const [key, value] of Object.entries(cacheHeaders ?? {})) {
          supabaseResponse.headers.set(key, value);
        }
      }
    }
  });

  // Do not trust a user/session object read directly from cookies. getClaims()
  // verifies the access token before protected pages are allowed through.
  const { data, error } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  const publicAuthRoute = pathname === "/login" || pathname.startsWith("/auth/");

  if (!publicAuthRoute && (error || !userId)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";

    const redirectResponse = NextResponse.redirect(loginUrl);
    copyAuthState(supabaseResponse, redirectResponse);
    return redirectResponse;
  }

  if (pathname === "/login" && userId) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";

    const redirectResponse = NextResponse.redirect(homeUrl);
    copyAuthState(supabaseResponse, redirectResponse);
    return redirectResponse;
  }

  return supabaseResponse;
}

function copyAuthState(source: NextResponse, target: NextResponse): void {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie.name, cookie.value);
  }

  for (const header of CACHE_HEADERS) {
    const value = source.headers.get(header);
    if (value) target.headers.set(header, value);
  }
}
