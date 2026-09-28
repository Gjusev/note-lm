import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { handleEngineRequest } from "@/engine/dispatch";

export const runtime = "nodejs";

/** Browser-dev adapter for the desktop transport (src/desktop/src/lib/transport.ts):
 *  same engine ops as the Tauri bridge, served by the Next dev server. The
 *  installed app never uses this — the window goes through invoke(). */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: "unauthorized", message: "Nicht angemeldet" } });
  if (!(await assertSameOrigin())) {
    return NextResponse.json({ ok: false, error: { code: "forbidden", message: "Ursprung nicht erlaubt" } });
  }

  const { op, args } = await req.json();
  if (typeof op !== "string") {
    return NextResponse.json({ ok: false, error: { code: "bad_args", message: "op is required" } });
  }

  const id = `http-${crypto.randomUUID()}`;
  const outcome = await handleEngineRequest(op, args ?? {});
  return NextResponse.json(
    outcome.ok
      ? { id, ok: true, result: outcome.result }
      : { id, ok: false, error: outcome.error }
  );
}
