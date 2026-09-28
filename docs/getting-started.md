# Getting started

[← Documentation](README.md) · [Architecture](architecture.md)

## Requirements

- Node.js compatible with Next.js 15 and npm.
- A self-hosted Convex deployment for product data and background jobs.
- PostgreSQL for Better Auth and Drizzle.
- FFmpeg for audio and video processing (the Docker image installs it).
- OpenAI-compatible credentials for transcription, embeddings, chat and optional TTS.
- A SearXNG endpoint for web and YouTube discovery.

## Configure

There is no checked-in `.env.example` in this export. Create the environment
for your deployment using the names read by the application:

| Variable | Purpose |
| :--- | :--- |
| `AUTH_DATABASE_URL` | PostgreSQL connection used by Better Auth/Drizzle |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Auth signing and origin |
| `NEXT_PUBLIC_APP_URL` | Public app origin used by the auth client |
| `NEXT_PUBLIC_CONVEX_URL` | Convex HTTP/client endpoint |
| `INTERNAL_API_KEY` | Server-to-Convex request authentication |
| `OPENAI_API_KEY` | OpenAI-compatible transcription, embedding, chat and TTS calls |
| `OPENAI_TRANSCRIPTION_MODEL` / `OPENAI_EMBEDDING_MODEL` / `OPENAI_CHAT_MODEL` / `OPENAI_TTS_MODEL` | Optional model overrides |
| `OPENAI_TTS_VOICE_HOST_1` / `OPENAI_TTS_VOICE_HOST_2` | Optional voices for generated audio |
| `SEAR_ENDPOINT` | SearXNG search endpoint |
| `AZURE_OCR_ENDPOINT` / `AZURE_OCR_KEY` | Optional OCR for scanned documents |
| `FFMPEG_PATH` | Optional FFmpeg executable override |
| `WORKER_KEY` | Credential for ingestion-worker mutations; the same value must be set in the Convex environment (`npx convex env set WORKER_KEY …`) |
| `MAX_PDF_MB` / `MAX_TEXT_MB` / `MAX_AUDIO_MB` / `MAX_VIDEO_MB` | Upload limits |
| `INGEST_DISABLE_YOUTUBE` | Set to `1` to disable the YouTube import provider |
| `INGEST_MAX_HTML_MB` / `INGEST_MAX_DOC_MB` / `INGEST_MAX_AUDIO_MB` / `INGEST_MAX_VIDEO_MB` | Import download limits |
| `INGEST_POLL_MS` | Worker job-poll interval (default 3000 ms) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google OAuth sign-in |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP transport for email flows |

Use placeholders locally. Never commit values for these variables.

## Run

```bash
npm install
npx drizzle-kit push
npx convex dev
npx convex env set WORKER_KEY <random-secret>   # same value as in the app environment
npm run dev
npm run worker        # ingestion worker for URL imports (pages, files, YouTube)
```

The commands assume PostgreSQL and Convex are already reachable. Open
[localhost:3000](http://localhost:3000). On PowerShell, use the same commands
in a PowerShell terminal; no `cp` step is needed because this export has no
environment template.

## Checks

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

`npm run test` runs the Vitest suite. Type checking and the production build
do not prove that Convex, PostgreSQL, SearXNG, FFmpeg or external model calls
are configured. A fresh full-stack run was not re-verified for this export.
