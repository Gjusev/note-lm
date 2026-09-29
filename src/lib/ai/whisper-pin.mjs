/**
 * whisper.cpp runtime pin — the ONE source of truth shared by the app
 * (engine op `runtimes.whisper` → src/lib/ai/whisper-runtime.ts) and the dev
 * script (scripts/fetch-whisper.mjs), so the app-managed download and the
 * dev checkout fetch the exact same bytes.
 *
 * License: whisper.cpp is MIT
 * (https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE) — we download
 * the release binary at install time, we do not redistribute it.
 *
 * Pinned to the newest STABLE release that actually ships binaries: the
 * "latest" v1.9.4 release carries no assets, so the pin is v1.9.2. Releases
 * publish NO checksum file — the digest below was observed at pin time (also
 * recorded in .probe-downloads/whisper-checksums.md) and is verified on every
 * download, BEFORE extraction.
 *
 * Deviation note: this is a `.mjs` (not `.ts`) so scripts/fetch-whisper.mjs
 * can import it under any Node >= 18 without type-stripping flags; tsconfig
 * has allowJs, so the engine side typechecks it like any module.
 */
export const WHISPER_TAG = process.env.NOTELM_WHISPER_TAG || "v1.9.2";
export const WHISPER_ASSET = "whisper-bin-x64.zip";
/** Download URL of the pinned win-x64 CPU zip. */
export const whisperZipUrl = () =>
  `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/${WHISPER_ASSET}`;
/** sha256 of the zip observed at pin time (no upstream sums published). */
export const WHISPER_ZIP_SHA256 =
  "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a";
