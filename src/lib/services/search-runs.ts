/**
 * Search provenance store (migration 0014): one row per PERFORMED search,
 * written by the `search.run` engine op right after `searchHybrid` ran. This
 * is what makes the evidence matrix's `not_found_in_search` real and honest
 * (docs/proposals/evidence-matrix.md §2): the status never claims a source
 * contains nothing — it names the exact search (query, scope, retrieval
 * recipe, time, returned chunk ids) whose result set held no chunk of that
 * source. Regenerating with a different query can legitimately flip a cell.
 */
import { desc, eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { searchRuns } from "@/db/local/schema";

/** One performed search, as the matrix and UI read it back. */
export interface SearchRunRecord {
  id: string;
  notebookId: string;
  query: string;
  /** The sources the search actually ran against (recorded scope). */
  sourceIds: string[];
  profileId: string | null;
  fusionPolicy: string | null;
  resultCount: number;
  resultChunkIds: string[];
  createdAt: number;
}

export interface SearchRunInput {
  notebookId: string;
  ownerId: string;
  query: string;
  /** Effective scope: the caller's selection, or every source of the
   *  notebook when the search ran unscoped. This is what a later
   *  latestSearchCovering matches against — record what was searched. */
  sourceIds: string[];
  profileId?: string | null;
  fusionPolicy?: string | null;
  resultCount: number;
  resultChunkIds: string[];
}

/** Insert one run row; returns the run id the caller reports back. */
export function recordSearchRun(db: LocalDb, run: SearchRunInput): string {
  const id = crypto.randomUUID();
  db.insert(searchRuns)
    .values({
      id,
      ownerId: run.ownerId,
      notebookId: run.notebookId,
      query: run.query,
      sourceIds: run.sourceIds,
      profileId: run.profileId ?? null,
      fusionPolicy: run.fusionPolicy ?? null,
      resultCount: run.resultCount,
      resultChunkIds: run.resultChunkIds,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

/**
 * The most recent run whose recorded scope INCLUDES sourceId (with its query,
 * recipe, time and result chunks), or null. A newer run that did NOT cover the
 * source does not supersede an older covering one — coverage is about scope,
 * not recency alone. Notebook-scoped: runs of other notebooks never match.
 *
 * ponytail: JSON scope column cannot be filtered in SQL — indexed ordered
 * scan of the notebook's runs, newest first, first scope hit wins. Split
 * scope into a (run_id, source_id) join table if notebooks grow thousands
 * of runs.
 */
export function latestSearchCovering(
  db: LocalDb,
  notebookId: string,
  sourceId: string
): SearchRunRecord | null {
  const rows = db
    .select()
    .from(searchRuns)
    .where(eq(searchRuns.notebookId, notebookId))
    .orderBy(desc(searchRuns.createdAt))
    .all();
  const covering = rows.find((r) => r.sourceIds.includes(sourceId));
  if (!covering) return null;
  return {
    id: covering.id,
    notebookId: covering.notebookId,
    query: covering.query,
    sourceIds: covering.sourceIds,
    profileId: covering.profileId,
    fusionPolicy: covering.fusionPolicy,
    resultCount: covering.resultCount,
    resultChunkIds: covering.resultChunkIds,
    createdAt: covering.createdAt,
  };
}
