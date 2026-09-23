# KI Research Notebook MVP Specification

## 1. Product Goal

Build a production quality MVP of a NotebookLM style web application.

The application allows users to create notebooks, upload sources, process those sources and ask questions against them using RAG.

The static user interface must be German.

AI generated answers should follow the language of the user's question unless the user explicitly asks for another language. If unclear, default to German.

The product should feel like a serious research notebook, not a generic SaaS dashboard.

Public landing page:

- Swiss neo brutalist
- Red accent
- Notebook and paper aesthetics
- Grid based editorial design
- Strong black and paper contrast
- Realistic notebook/paper visual language

Internal app:

- Inspired by NotebookLM
- Clean source driven workspace
- Left sources panel
- Center chat
- Right notes and learning materials panel
- Calm and productive UI
- German static UI copy everywhere

## 2. Tech Stack

Use:

- Next.js App Router
- TypeScript
- npm
- Tailwind CSS
- shadcn/ui where useful
- Better Auth
- Drizzle ORM
- PostgreSQL self hosted
- Convex self hosted
- OpenAI API
- FFmpeg server side
- GSAP for selected high quality animations
- Framer Motion for dialogs and learning material animations if useful
- Optional Playwright for PDF export
- Optional PptxGenJS for PPTX export

Use npm only.

Do not use pnpm.

Do not use yarn.

## 3. Skill Usage

Claude Code must use available skills whenever they match the task.

Before implementing related work, check whether a relevant skill is available and use it.

Prioritize available skills for Better Auth, Convex, Drizzle, PostgreSQL, GSAP, Next.js, Tailwind CSS, shadcn/ui, UI design, brand identity, animation, accessibility and security review.

If a relevant skill is available, follow its workflow and instructions.

If no relevant skill is available, continue with official documentation and this specification.

Skills must not override hard constraints.

## 4. Agent Sessions Deliverable

The email requesting this coding task asks for agent sessions in Markdown format.

Therefore, the repository must include an `agent-sessions/` folder.

Required files:

```txt
agent-sessions/00-overview.md
agent-sessions/01-planning.md
agent-sessions/02-implementation.md
agent-sessions/03-debugging-and-fixes.md
agent-sessions/04-final-review.md
```

Claude Code must update these files while implementing the project.

If Claude Code supports session export through `/export`, important sessions should be exported into the `agent-sessions/` folder.

If direct export is not practical, Claude Code must create concise Markdown summaries manually.

Each agent session file should include:

- session goal
- relevant prompt or high level instruction
- implementation decisions
- architecture decisions
- files changed
- errors encountered
- fixes applied
- tests/checks executed
- remaining limitations

Do not include secrets, API keys, tokens, private URLs or credentials.

The files in `agent-sessions/` are part of the final deliverable and should be committed.

### 00-overview.md requirements

`00-overview.md` must explain:

- which agent/tool was used
- why Claude Code was used
- how the project was split into implementation phases
- which parts were implemented with AI assistance
- which checks were run
- known limitations

Suggested note:

```txt
This project was implemented with Claude Code as the main coding agent. The implementation was guided by CLAUDE.md and docs/specs/ki-research-notebook-mvp.md.
```

### Required agent session template

Use this structure for every session file:

```md
# Agent Session: <Title>

## Goal

Briefly describe what this session was supposed to achieve.

## Instructions / Prompt Summary

Summarize the relevant instructions given to the agent.

## Decisions

List important technical and product decisions.

## Files Changed

List important files created or modified.

## Issues Encountered

Describe errors, blockers or design conflicts.

## Fixes Applied

Explain how the issues were solved.

## Checks Executed

List commands such as npm run lint, npm run build or manual checks.

## Remaining Limitations

State what is incomplete or intentionally simplified.
```

## 5. Infrastructure Context

PostgreSQL is already deployed self hosted.

Convex is already deployed self hosted.

PostgreSQL must only be used for Better Auth and Drizzle auth tables.

Convex must be used for all product data, functions, storage, source metadata, jobs, chunks, messages, notes, learning materials and exports.

Never store product data in PostgreSQL.

Never create notebooks, sources, chunks, messages, notes, processing jobs, learning materials or files in PostgreSQL.

## 6. Package Installation

Use npm.

Required dependencies:

```bash
npm install better-auth @better-auth/drizzle-adapter drizzle-orm pg
npm install convex openai
npm install lucide-react clsx tailwind-merge class-variance-authority
npm install zod
npm install fluent-ffmpeg
npm install pdf-parse
npm install gsap @gsap/react
npm install framer-motion
npm install @radix-ui/react-slot
npm install -D drizzle-kit @types/pg @types/fluent-ffmpeg
```

Optional exports:

```bash
npm install pptxgenjs
npm install playwright
```

## 7. Authentication

Use Better Auth with Drizzle adapter and PostgreSQL.

Create this structure:

```txt
src/db/auth/index.ts
src/db/auth/schema.ts
src/lib/auth.ts
src/app/api/auth/[...all]/route.ts
drizzle.config.ts
```

Use this environment variable for PostgreSQL auth:

```env
AUTH_DATABASE_URL=
```

Do not use DATABASE_URL for product data.

Better Auth requirements:

- Enable email and password auth
- Create login page
- Create register page
- Create logout flow
- Protect all routes under `/app`
- Redirect unauthenticated users to `/login`
- Do not expose secrets to the client
- Do not trust userId from the client
- Resolve authenticated user server side through Better Auth

## 8. Convex Self Hosted

Convex owns all product data.

Convex records should use the Better Auth user id as `ownerId`.

Do not build a second user system in Convex.

Do not accept `ownerId` or `userId` directly from the client.

Environment variables:

```env
NEXT_PUBLIC_CONVEX_URL=
CONVEX_DEPLOYMENT=
CONVEX_SELF_HOSTED_URL=
CONVEX_SELF_HOSTED_ADMIN_KEY=
INTERNAL_API_KEY=
```

`CONVEX_SELF_HOSTED_ADMIN_KEY` is server only.

Never expose it to the browser.

Use `INTERNAL_API_KEY` to protect internal server-to-server routes and Convex HTTP Actions.

Expected internal header:

```txt
x-internal-key: <INTERNAL_API_KEY>
```

If the key is missing or invalid, return 401.

Use Convex internal functions for logic that should never be callable from the client.

## 9. Product Data Model

Create Convex schema for:

- notebooks
- sources
- processingJobs
- chunks
- messages
- notes
- learningMaterials

`learningMaterials` must support:

```txt
summary | flashcards | quiz | studyGuide | keyInsights | podcastSummary | slides
```

## 10. Product Decision: No YouTube

Do not implement YouTube ingestion.

The MVP supports only files uploaded directly by the user:

- PDF
- TXT
- Markdown
- Audio files
- Local video files uploaded by the user

## 11. File Limits

Use these MVP limits:

```txt
PDF max 20 MB
TXT and Markdown max 5 MB
Audio max 50 MB
Video max 100 MB or 15 minutes
Max 10 sources per notebook
Max 250 MB total uploaded files per notebook
Transcription chunks sent to the API must be below 25 MB, preferably 20 to 24 MB
```

## 12. Media Processing

Audio:

- transcribe uploaded audio
- store transcript
- chunk transcript
- generate embeddings
- use chunks for RAG

Video:

- convert uploaded video to audio with FFmpeg
- transcribe extracted audio
- store transcript
- chunk transcript
- generate embeddings
- use chunks for RAG

Do not process video directly as video.

## 13. FFmpeg

Use FFmpeg server side only.

Do not use Edge Runtime for FFmpeg.

Any route handler using FFmpeg must include:

```ts
export const runtime = "nodejs";
```

Support:

```env
FFMPEG_PATH=
```

## 14. OpenAI and Whisper

Use OpenAI for:

- transcription
- embeddings
- chat completion
- learning material generation
- podcast audio generation through TTS

Whisper is only for speech-to-text transcription.

Do not use Whisper for generating podcast audio.

Podcast audio uses TTS.

Environment variables:

```env
OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_TRANSCRIPTION_FALLBACK_MODEL=whisper-1
WHISPER_MODEL=whisper-1
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE_HOST_1=marin
OPENAI_TTS_VOICE_HOST_2=cedar
```

Podcast audio flow:

1. Generate podcast script from notebook sources.
2. Store script as learning material content.
3. User clicks `Audio generieren`.
4. Generate audio with TTS.
5. Use different voices for Host 1 and Host 2 if possible.
6. Concatenate audio with FFmpeg.
7. Store final MP3 in Convex Storage.
8. Show audio player in dialog.

## 15. RAG Behavior

Retrieve relevant chunks from the current notebook only.

Answer in the same language as the user's question unless explicitly requested otherwise.

If unclear, default to German.

Include citations.

Do not invent citations.

Do not answer from general knowledge unless explicitly allowed later.

German fallback:

```txt
Dazu finde ich keine ausreichende Information in deinen hochgeladenen Quellen.
```

## 16. Pages

Create:

```txt
/
Landing page

/login
Login page

/register
Register page

/app
Protected dashboard

/app/notebooks/[id]
Protected notebook detail page

/architektur
Public architecture documentation page
```

## 17. Architecture Documentation Page

Create `/architektur`.

The page must be German.

It must document the project architecture and explain the system structure.

It must state:

```txt
Dieses Projekt wurde von GLM-5.1 in einem Coding Pass mit Claude Code programmiert.
```

Add a link to `/architektur` in the landing footer.

The page should explain:

- overview
- technology stack
- authentication
- Convex product backend
- source processing
- RAG pipeline
- learning materials
- podcast and audio
- slide generation and export
- security boundaries
- project structure
- development note

Do not expose secrets, internal URLs, tokens or credentials.

## 18. Landing Page

The landing page must be in German.

Visual style:

- Swiss neo brutalist
- strong grid system
- notebook and paper aesthetics
- red accent
- black and paper white contrast
- editorial numbering
- large typography
- hard borders
- realistic notebook inspired composition

Hero copy:

```txt
Deine Quellen.
Klar verstanden.

Lade Dokumente, Audios und Videos hoch. Stelle Fragen und erhalte präzise Antworten mit nachvollziehbaren Quellen.

Kostenlos starten
Demo ansehen
```

## 19. Internal Notebook Workspace

The internal notebook interface should be inspired by NotebookLM.

Desktop layout:

- left: Quellen
- center: Chat
- right: Notizen and Lernmaterialien

Keep the workspace calm, readable and productive.

Do not make the internal app too decorative.

## 20. Learning Materials

Right sidebar section:

```txt
Lernmaterialien
```

Supported types:

```txt
Zusammenfassung
Karteikarten
Quiz
Lernleitfaden
Wichtige Erkenntnisse
Podcast-Zusammenfassung
Präsentation
```

Learning materials are generated only after explicit user request.

Do not allow multiple active generations of the same type for the same notebook.

This must be enforced in the backend, not only in UI.

Completed materials appear as cards.

Clicking a card opens a centered animated dialog.

Flashcards must support flip animation.

Podcast summary can generate optional audio through explicit `Audio generieren`.

Slides should be rendered as HTML/CSS and exportable to HTML and PDF. PPTX is optional.

## 21. Slide Export

Implement export to HTML and PDF for the MVP.

PPTX export is optional.

Use Node.js runtime for Playwright or export processing.

Do not use Edge Runtime.

## 22. GSAP and Animation Guidelines

Use GSAP for selected high quality animations, especially on the landing page and focused interactive moments.

Use `@gsap/react` and `useGSAP()` where GSAP is used.

Do not overanimate the internal notebook workspace.

## 23. German Static UI Requirement

All static user facing text must be German.

AI generated text is not forced to German. It should follow the user query language unless otherwise requested.

## 24. Quality Requirements

- TypeScript
- clean code
- no hardcoded secrets
- German static UI
- good error handling
- loading states
- empty states
- responsive landing page
- responsive app layout
- no YouTube ingestion
- no product data in PostgreSQL
- no Edge Runtime for FFmpeg, Playwright or heavy file processing
- no files above MVP limits
- no client-provided user IDs
- no GDPR compliance claims unless fully implemented

## 25. Testing and Validation

After implementation, run:

```bash
npm run lint
npm run build
```

If available:

```bash
npm run typecheck
```

Fix errors before finishing.

## 26. Implementation Order

1. Inspect repository.
2. Read CLAUDE.md and this spec.
3. Check available skills.
4. Create/update `agent-sessions/00-overview.md`.
5. Create implementation plan.
6. Update `agent-sessions/01-planning.md`.
7. Build landing page.
8. Build `/architektur`.
9. Set up Better Auth, Drizzle and PostgreSQL.
10. Set up Convex schema.
11. Build protected dashboard and notebook layout.
12. Implement uploads and processing.
13. Implement RAG chat.
14. Implement learning materials.
15. Implement podcast summary and optional audio.
16. Implement slide generation and export.
17. Update `agent-sessions/02-implementation.md`.
18. Run checks and debug.
19. Update `agent-sessions/03-debugging-and-fixes.md`.
20. Final review.
21. Update `agent-sessions/04-final-review.md`.

## 27. Completion Report

When finished, provide:

- summary
- changed files
- setup instructions
- environment variables
- migration steps
- known limitations
- next production improvements
- agent session files created or updated
