import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (isSafeLocalTestRequest(request)) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};

function isSafeLocalTestRequest(request: NextRequest): boolean {
  if (process.env.LOCAL_TEST_MODE !== "true") return false;
  const hostname = request.nextUrl.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
