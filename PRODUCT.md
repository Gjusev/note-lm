# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

React/Vite rendered inside a Tauri 2 desktop application. The product is an installed desktop program; this design-platform value describes the rendering technology, not a requirement to use a browser or hosted service.

## Product Purpose

An open-source notebook for researching and learning from documents, web resources, audio, video and tabular data. Preserve evidence and its source versions, help review changes, and keep research portable.

## Users

Research and study are confirmed use cases. The first audience and their relative priority remain open. The current design proposal assumes research as the primary workflow and study as a related workflow; this is a hypothesis, not a confirmed audience decision.

## Operating Context

The user wants all work available inside one installed program. No manual container, Convex deployment, server startup or runtime installation. Local inference and local hybrid RAG are required; remote providers with user-supplied keys are optional. Workers require progress, pause, cancellation, retry and recovery.

## Capabilities and Constraints

- Extend the existing Tauri application, TypeScript engine, SQLite storage and worker system.
- The repository declares MIT licensing. Check licenses of dependencies, models and distributed resources individually.
- Preserve source versions and distinguish evidence from generated interpretation.
- Keep offline processing explicit and prevent silent remote substitution.
- Repository implementation is changing concurrently; consult ARCHITECTURE.md, current code and test evidence for delivery status.
- PageIndex was not adopted for the evaluated configuration; Docling and other research candidates are separate decisions.

## Brand Commitments

Working name: note-lm. The existing design uses paper and ink neutrals with a muted red accent. Preserve that identity while researching better desktop composition. Product specifications are Spanish; the existing app interface is German, as established in CONTEXT.md. No rebrand or app-wide language change has been decided.

## Evidence on Hand

- src/desktop/src/styles/tokens.css and the desktop screens are incumbent visual evidence.
- docs/specs/open-source-innovation-strategy.md records research hypotheses and experiments.
- eval/pageindex-proto/pi2-decision-report.md records the PageIndex decision.
- Existing synthetic evaluations do not establish broad real-world performance or user preference.

## Product Principles

- Let users inspect the evidence supporting a conclusion.
- Keep originals, revisions and human decisions recoverable.
- Make processing location and task state understandable.
- Evaluate technology against useful tasks and hardware budgets.
- Provide portable data and a contribution path for the open-source project.

## Accessibility & Inclusion

Keyboard operation, readable text, clear focus, non-color state indicators, reduced motion and adaptable desktop layouts are design requirements. Standards conformance remains to be verified through testing; it is not claimed here.
