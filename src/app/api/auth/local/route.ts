import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getOrCreateProfile } from "@/lib/services/profile";
import { SESSION_COOKIE } from "@/lib/server/local-user";

export const runtime = "nodejs";

/**
 * Local app session: GET returns the profile; GET ?start=1&next=/app creates
 * the HttpOnly session cookie (first visit / after launcher start) and
 * redirects to `next`. There is no login — identity is the local profile.
 */
export async function GET(req: NextRequest) {
  const { db } = getLocalContext();
  const profile = await getOrCreateProfile(db);

  const start = req.nextUrl.searchParams.get("start");
  if (start === "1") {
    const next = req.nextUrl.searchParams.get("next") || "/app";
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
    const res = NextResponse.redirect(new URL(safeNext, req.url));
    res.cookies.set(SESSION_COOKIE, profile.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // loopback-only app: no Secure (would break plain http://127.0.0.1)
    });
    return res;
  }

  return NextResponse.json({ user: { id: profile.id, name: profile.name, email: profile.email } });
}
