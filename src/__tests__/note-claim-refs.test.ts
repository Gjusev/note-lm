import { describe, expect, it } from "vitest";
import { parseClaimRefs } from "../desktop/src/workspace/NoteEditor";

/**
 * Note reference marker contract (reader + provenance slice): "In Notiz
 * einfügen" (NotebookWorkspace) appends
 *   > „quote" — file · vN · S. page [@claim:<claimId>]
 * to the note content; the NoteEditor parses the same marker to render its
 * navigable chips. The format spans two files - this test pins it so the
 * writer and the parser cannot drift apart silently. (No desktop UI test
 * harness exists; this is the pure-logic half of the contract only.)
 */
describe("note claim reference markers", () => {
  const block = (id: string) => `\n\n> „Zitat" — quelle.pdf · v1 · S. 3 [@claim:${id}]`;

  it("parses the claim id out of an inserted quote block", () => {
    expect(parseClaimRefs(block("c_abc123"))).toEqual(["c_abc123"]);
  });

  it("dedupes repeated markers and keeps first-seen order", () => {
    expect(parseClaimRefs(block("a") + block("b") + block("a"))).toEqual(["a", "b"]);
  });

  it("ignores text without a well-formed marker", () => {
    expect(parseClaimRefs("normale Notiz [@claim:] x@claim:y [@claim:Ä!]")).toEqual([]);
  });
});
