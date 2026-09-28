import { cookies, headers } from "next/headers";
import { getLocalContext } from "@/lib/storage/local";
import { getOrCreateProfile, type LocalProfile } from "@/lib/services/profile";

/**
 * Local single-user identity + app-session gate.
 *
 * The app session is an HttpOnly cookie (`notelm_session`) that the local
 * launcher/start page sets on first visit. Defense for a loopback-only app:
 * the server binds 127.0.0.1, the cookie blocks cross-site requests from
 * riding the browser's network access, and mutating API routes additionally
 * verify Origin when present. No remote users, no CORS.
 *
 * ponytail: startup token in URL (plan §2) deferred to the launcher phase;
 * add it there if the cookie gate proves insufficient.
 */

export const SESSION_COOKIE = "notelm_session";

export async function getSessionUser(): Promise<LocalProfile | null> {
  const store = await cookies();
  if (!store.get(SESSION_COOKIE)) return null;
  const { db } = getLocalContext();
  return getOrCreateProfile(db);
}

/** Like getSessionUser but creates the profile row when the cookie exists. */
export async function requireSessionUser(): Promise<LocalProfile> {
  const user = await getSessionUser();
  if (!user) throw new Error("Nicht angemeldet");
  return user;
}

/** Reject cross-origin mutations: a website open in another tab must not be
 *  able to POST to our loopback API. No Origin header (same-origin GET /
 *  curl) is allowed — the cookie + loopback bind carry those. */
export async function assertSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return true;
  const host = h.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}
