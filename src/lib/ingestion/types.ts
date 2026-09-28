// Internal contracts for the resource importer. Independent design for note-lm.

export type ProviderId = "youtube" | "web" | "direct-file";

export type ResourceKind = "video" | "audio" | "document" | "page";

/** Result of local URL classification — no network access. */
export interface IdentifiedResource {
  provider: ProviderId;
  kind: ResourceKind;
  /** Stable resource key, e.g. "youtube:video:dQw4w9WgXcQ" or "web:https://..." */
  resourceKey: string;
  /** Original URL as given by the user (provenance, kept verbatim). */
  originalUrl: string;
  /** Canonical URL for dedup/citation when it differs from the original. */
  canonicalUrl: string;
  /** Provider-specific id (e.g. YouTube video id), when available locally. */
  externalId?: string;
}

/** Adapter contract. identify() is local-only; inspect/resolve may use the network. */
export interface ProviderAdapter {
  id: ProviderId;
  /** Metadata without downloading the full file. Fields unknown stay undefined. */
  inspect(resource: IdentifiedResource): Promise<InspectResult>;
  /** Download plan, produced right before consumption. Temporary URLs stay server-side. */
  resolve(resource: IdentifiedResource, selection?: ItemSelection): Promise<DownloadPlan>;
}

export interface InspectResult {
  title?: string;
  author?: string;
  durationSeconds?: number;
  /** Selectable items when a resource exposes more than one (future: playlists). */
  items?: InspectItem[];
}

export interface InspectItem {
  id: string;
  label: string;
}

export interface ItemSelection {
  itemId: string;
}

export interface DownloadPlan {
  /** URL to fetch; validated against the network policy before every request. */
  url: string;
  headers?: Record<string, string>;
  /** Expected general category, used to catch HTML masquerading as media. */
  expect: "html" | "document" | "audio" | "video";
  fileNameHint?: string;
}

/** Error codes the worker maps to retry behaviour. */
export type ImportErrorCode =
  | "unrecognized_url"
  | "unsupported"
  | "unavailable"
  | "blocked" // server-side download not possible (e.g. platform blocks datacenter IPs)
  | "too_large"
  | "bad_content"
  | "network"
  | "timeout"
  | "rate_limited"
  | "extractor"
  | "internal";

export class ImportError extends Error {
  code: ImportErrorCode;
  /** transient errors are retried with backoff. */
  transient: boolean;
  retryAfterMs?: number;

  constructor(code: ImportErrorCode, message: string, opts?: { transient?: boolean; retryAfterMs?: number }) {
    super(message);
    this.code = code;
    this.transient = opts?.transient ?? false;
    this.retryAfterMs = opts?.retryAfterMs;
  }
}
