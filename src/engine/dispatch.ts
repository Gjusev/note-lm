/**
 * Engine operation dispatch (issue #10): the seam where engine ops meet the
 * local services, with no HTTP or Next transport involved.
 */
import { getLocalContext } from "@/lib/storage/local";
import { getOrCreateProfile } from "@/lib/services/profile";
import { createNotebook, listNotebooks } from "@/lib/services/notebooks";

export type EngineResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

export const PROTOCOL_VERSION = 1;

export async function handleEngineRequest(op: string, args: unknown): Promise<EngineResult> {
  try {
    switch (op) {
      case "protocol.version":
        return { ok: true, result: { version: PROTOCOL_VERSION } };

      case "notebooks.create": {
        const { title } = args as { title?: string };
        if (!title || typeof title !== "string") {
          return { ok: false, error: { code: "bad_args", message: "title is required" } };
        }
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        const id = await createNotebook(db, { ownerId: profile.id, title });
        return { ok: true, result: { id } };
      }

      case "notebooks.list": {
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        return { ok: true, result: await listNotebooks(db, profile.id) };
      }

      default:
        return {
          ok: false,
          error: { code: "unknown_op", message: `Unknown operation: ${op}` },
        };
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: "internal", message: err instanceof Error ? err.message : String(err) },
    };
  }
}
