/**
 * Curated model catalog (I0): a tiny hand-maintained list of GGUF models the
 * project validated locally. Hashes are the Hugging Face LFS oids, cross
 * checked against the downloaded files (sha256sum of the local copies in
 * .probe-downloads matched). Downloads are user-initiated only — nothing here
 * auto-fetches. Every entry carries its license: we link the upstream file,
 * we do not redistribute it.
 */
export interface CatalogModel {
  id: string;
  label: string;
  capability: "chat" | "embed" | "transcribe";
  sizeBytes: number;
  license: string;
  /** SHA-256 of the GGUF (= Hugging Face LFS oid); verified after download. */
  sha256: string;
  /** Direct download URL; null when the pipeline cannot serve the file. */
  url: string | null;
  notes: string;
}

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: "qwen2.5-0.5b-instruct-q4-k-m",
    label: "Qwen2.5-0.5B Instruct (Q4_K_M)",
    capability: "chat",
    sizeBytes: 491_400_032,
    license: "Apache-2.0",
    sha256: "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
    url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
    notes: "Kleines Chat-Modell für schwache Hardware; im Projekt lokal getestet.",
  },
  {
    id: "bge-small-en-v1.5-q8-0",
    label: "BGE small EN v1.5 (Q8_0)",
    capability: "embed",
    sizeBytes: 36_806_944,
    license: "MIT",
    sha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
    url: "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf",
    notes: "Englisches Embedding-Modell für die semantische Suche.",
  },
  {
    id: "qwen2.5-7b-instruct-q4-k-m",
    label: "Qwen2.5-7B Instruct (Q4_K_M, 2 Teile)",
    capability: "chat",
    sizeBytes: 4_690_984_448, // both shards together (~4.7 GB)
    license: "Apache-2.0",
    sha256: "dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db",
    url: null,
    // ponytail: Split-GGUF has no single-file pipeline — the managed store
    // renames downloads to <sha256>.gguf, so llama.cpp cannot find shard 2.
    // Add multi-shard download/import when a real user asks for 7B locally.
    notes: "In zwei Shard-Dateien veröffentlicht; die Einzeldatei-Verwaltung kann Split-Modelle noch nicht laden — daher kein Download-Button.",
  },
  {
    id: "ggml-tiny",
    label: "Whisper tiny (mehrsprachig)",
    capability: "transcribe",
    sizeBytes: 77_691_713,
    license: "MIT",
    sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    notes: "Whisper tiny: schnelle lokale Transkription, ~78 MB, mehrsprachig (en/de/es) — passt für schwache Hardware.",
  },
  {
    id: "ggml-base",
    label: "Whisper base (mehrsprachig)",
    capability: "transcribe",
    sizeBytes: 147_951_465,
    license: "MIT",
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    notes: "Whisper base: etwas genauer als tiny, ~148 MB, mehrsprachig (en/de/es).",
  },
];
