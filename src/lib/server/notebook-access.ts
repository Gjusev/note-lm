import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { convexQuery } from "./convex-api";

/**
 * Server-side authorization for notebook-scoped operations: the user comes
 * from the Better Auth session (never from the request body), and notebook
 * ownership is verified against Convex.
 */

export interface SessionUser {
  id: string;
  email: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;
  return { id: session.user.id, email: session.user.email };
}

interface NotebookDoc {
  ownerId: string;
}

export async function userOwnsNotebook(userId: string, notebookId: string): Promise<boolean> {
  try {
    const { value } = await convexQuery<{ value: NotebookDoc | null }>("notebooks:get", { notebookId });
    return !!value && value.ownerId === userId;
  } catch {
    return false;
  }
}
