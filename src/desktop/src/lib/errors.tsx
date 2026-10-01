/**
 * Engine error contract (i18n slice): every engine failure the UI shows
 * carries a STABLE code (dispatch.ts, ProbeError, CalculationError,
 * NotebookImportError, protocol frame errors). This module maps code ->
 * localized primary line; the raw engine message (German) stays visible as
 * the muted detail line. Unknown/missing codes fall back to the raw message
 * alone — the pre-contract behavior, byte for byte.
 */
import { t } from "../i18n";

/** Error thrown by api.call(): the engine reply's {code, message}, intact. */
export class EngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

/** engine error code -> i18n key; unmapped codes fall back to the raw message */
export const ERRORS: Record<string, string> = {
  // dispatch-level generics
  bad_args: "err.badArgs",
  not_found: "err.notFound",
  internal: "err.internal",
  unknown_op: "err.unknownOp",
  busy: "err.busy",
  conflict: "err.conflict",
  not_available: "err.notAvailable",
  bad_url: "err.badUrl",
  profile_incomplete: "err.profileIncomplete",
  runtime_install_failed: "err.runtimeInstallFailed",
  import_failed: "err.importFailed",
  download_failed: "err.downloadFailed",
  export_failed: "err.exportFailed",
  no_provider: "err.noProvider",
  secret_unavailable: "err.secretUnavailable",
  chat_failed: "err.chatFailed",
  // transport frame (engine protocol)
  bad_frame: "err.badFrame",
  frame_too_large: "err.frameTooLarge",
  // CalculationError
  no_header: "err.calcNoHeader",
  unknown_column: "err.calcUnknownColumn",
  not_a_number: "err.calcNotANumber",
  ambiguous_cell: "err.calcAmbiguousCell",
  no_data: "err.calcNoData",
  not_a_sheet: "err.calcNotASheet",
  // ProbeError (provider test)
  timeout: "err.probeTimeout",
  auth_failed: "err.probeAuthFailed",
  bad_base_url: "err.probeBadBaseUrl",
  offline_blocked: "err.probeOfflineBlocked",
  capability_unsupported: "err.probeCapabilityUnsupported",
  no_base_url: "err.probeNoBaseUrl",
  // service sub-codes (this slice)
  download_sha_mismatch: "err.downloadShaMismatch",
  package_invalid: "err.packageInvalid",
  notebook_exists: "err.notebookExists",
};

type Coded = { code?: unknown; message?: unknown };

/** Stable code of an error-like value, when it carries one. */
export function errorCode(e: unknown): string | undefined {
  return typeof (e as Coded)?.code === "string" ? (e as { code: string }).code : undefined;
}

/** Localized primary line + raw engine message as detail (null when the code
 *  is unmapped — then primary IS the raw message, the old behavior). Accepts
 *  Error instances and plain {code, message} shapes (stored probe outcomes). */
export function errorText(e: unknown): { primary: string; detail: string | null } {
  const code = errorCode(e);
  const raw = e instanceof Error
    ? e.message
    : typeof (e as Coded)?.message === "string"
      ? (e as { message: string }).message
      : String(e);
  const key = code ? ERRORS[code] : undefined;
  return { primary: key ? t(key) : raw, detail: key ? raw : null };
}

/** The one render rule for engine failures: localized primary in the alert
 *  line, raw engine message as an always-visible muted detail line (errors
 *  are rare and the detail is one short sentence — no disclosure needed). */
export function ErrorLine({ e, style }: { e: unknown; style?: React.CSSProperties }) {
  const { primary, detail } = errorText(e);
  return (
    <>
      <p role="alert" style={{ color: "var(--accent)", margin: 0, ...style }}>{primary}</p>
      {detail != null && (
        <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>{detail}</p>
      )}
    </>
  );
}
