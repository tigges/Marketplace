import { type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

/**
 * Refresh the Supabase session on every request so Server Components and API
 * routes always see a valid, non-expired JWT. Only runs when Supabase is
 * configured; if the env vars are absent the middleware is a no-op pass-through
 * so local dev without Supabase still works.
 */
export async function middleware(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    // Supabase not configured — pass through unchanged.
    const { NextResponse } = await import("next/server");
    return NextResponse.next();
  }

  const { supabase, response } = createClient(request);
  // getUser() is the only call that reliably refreshes the JWT against the
  // Auth server. Do NOT replace this with getSession() — it reads the local
  // cookie and will miss expirations.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
