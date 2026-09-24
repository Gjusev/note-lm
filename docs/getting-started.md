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
| `CONVEX_SELF_HOSTED_URL` / `CONVEX_SELF_HOSTED_ADMIN_KEY` | Server-side self-hosted Convex access |
| `INTERNAL_API_KEY` | Server-to-Convex request authentication |
| `OPENAI_API_KEY` | OpenAI-compatible transcription, embedding, chat and TTS calls |
| `OPENAI_TRANSCRIPTION_MODEL` / `OPENAI_EMBEDDING_MODEL` / `OPENAI_CHAT_MODEL` / `OPENAI_TTS_MODEL` | Optional model overrides |
| `SEAR_ENDPOINT` | SearXNG search endpoint |
| `AZURE_OCR_ENDPOINT` / `AZURE_OCR_KEY` | Optional OCR for scanned documents |
| `FFMPEG_PATH` | Optional FFmpeg executable override |
| `MAX_PDF_MB` / `MAX_TEXT_MB` / `MAX_AUDIO_MB` / `MAX_VIDEO_MB` | Upload limits |

Use placeholders locally. Never commit values for these variables.

## Run

```bash
npm install
npx drizzle-kit push
npx convex dev
npm run dev
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
npm run build
```

`npm run test` runs the Vitest suite. Type checking and the production build
do not prove that Convex, PostgreSQL, SearXNG, FFmpeg or external model calls
are configured. A fresh full-stack run was not re-verified for this export.
