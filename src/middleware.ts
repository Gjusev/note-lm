import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Gate for the local app session: /api/auth/local?start=1 sets the HttpOnly
 *  cookie and bounces back to the requested page. No remote accounts. */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/app")) {
    if (!request.cookies.get("notelm_session")) {
      const start = new URL("/api/auth/local", request.url);
      start.searchParams.set("start", "1");
      start.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(start);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
