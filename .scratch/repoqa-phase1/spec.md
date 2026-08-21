---
Status: ready-for-agent
Feature: RepoPulse Phase 1 backend closed loop
Owner: Product panel (Product Manager / Behavioral Nudge Engine / Feedback Synthesizer / Sprint Prioritizer)
Source: docs/repoqa-review.md, ADR-0001..0004, HANDOFF.md
---

# RepoPulse Phase 1: Deterministic Java Static Trace Closed Loop

## Problem Statement

New developers and architects cannot reliably answer questions like "which classes does this API route touch" without manual code archaeology, mentor interruptions, or untrusted LLM guesses. The PRD promises a read-only code-intelligence workbench, but the current implementation only has contracts, database schema, repository CRUD, and worker stubs: importing a Java repo does not produce symbols, chunks, SSE answers, or verified source anchors. The MVP also claims semantic retrieval and an `embedding` index phase that do not exist, so the product currently over-promises and under-delivers.

## Solution

RepoPulse Phase 1 delivers a closed, local-first, read-only Java static trace loop on the Control Plane: import a local Java Spring Boot repo, extract AST symbols and call edges into SQLite, chunk README/doc comments, then answer questions over SSE with deterministic call chains, Mermaid diagrams, and validated `code://` anchors. Security gates (secret masking and path traversal protection) and a frozen golden dataset eval harness must exist before any real LLM call. The `embedding` state and semantic retrieval claims are removed in Phase 1; search is structured AST plus keyword/chunk lookup, with optional future embeddings only if eval proves they are needed.

## User Stories

1. As a backend developer new to a Java Spring Boot repo, I want to import a local repo, so that I can query its architecture without leaving my machine.
2. As a developer, I want to see indexing progress through cloning, parsing, and ready states, so that I know when queries become available.
3. As a developer importing a large repo, I want the system to suggest shrinking the scope to a submodule or fail with a clear reason, so that I do not wait forever on an unsupported index.
4. As a developer, I want re-importing or re-indexing the same repo to be idempotent, so that stale or duplicate symbols never poison later answers.
5. As a developer returning after a Control Plane restart, I want repo status and data to persist and recover, so that I can resume without losing the index.
6. As a developer, I want to list imported repos and their status, so that I can choose what to inspect next.
7. As a developer, I want to browse extracted routes, classes, methods, and fields with file and line locations, so that I can navigate the code from the API surface.
8. As a developer, I want to ask a question in natural language, so that I do not need to learn slash commands or query modes first.
9. As a developer, I want the system to route my question into architecture, call-chain, or environment handling automatically, so that I get the right tooling without extra choices.
10. As a developer, I want query answers to stream as token, mermaid, anchors, and done events over SSE, so that the interface can render progressively.
11. As a developer, I want deterministic call chains with real symbol edges, so that I can trace a request end to end with reproducible evidence.
12. As a developer, I want static analysis breaks to be marked explicitly instead of auto-completed, so that I never mistake a guess for ground truth.
13. As a developer, I want every anchor to pass raw-file validation before presentation, so that clicking a line always lands on real code.
14. As a developer, I want `/file/raw` to reject path traversal attempts, so that reading source files cannot escape the indexed repo.
15. As a developer, I want passwords, tokens, API keys, AK/SK, and private keys masked before code context reaches any LLM or UI, so that secrets stay local and never leak.
16. As a developer, I want environment answers to expose config key names and file locations without their values, so that I can debug configuration safely.
17. As a developer, I want README and doc-comment chunks searchable, so that environment and architecture questions have deterministic fallback evidence.
18. As a developer, I want at least one suggested next action after an answer, so that I never stare at an empty next step.
19. As a product owner, I want local read-only query events recorded, so that adoption, failure, and anchor-click signals can be measured later without uploading anything.
20. As a maintainer, I want golden dataset eval to report route-chain, config, and architecture buckets separately, so that regressions are attributable and not hidden inside an average.
21. As a maintainer, I want prompt or tool-loop changes to happen only after an eval baseline passes, so that quality claims stay accountable.
22. As a maintainer, I want first-token latency measured consistently and browser render latency measured separately later, so that server and UX performance are not conflated.

## Implementation Decisions

- Phase 1 scope: local Java (Spring Boot) AST symbol extraction + SQLite + SSE + validated anchors only; GitHub clone, TypeScript, embedding, and PNG export are deferred.
- Bootstrap: extend the existing Control Plane HTTP app dependencies with the RepoQA repository and worker so `/health` and existing harness routes keep working while RepoQA routes are added.
- Public API: add `GET /api/repos`, `POST /api/repos`, `GET /api/repos/:id/symbols`, `GET /api/repos/:id/query` (SSE), and `GET /api/repos/:id/file/raw`, matching the existing Express patterns.
- Index lifecycle: statuses transition through `idle -> indexing -> ready | error`; the `embedding` progress phase and any semantic-retrieval wording are removed from contracts and events, per ADR-0002.
- Symbol extraction: parser extracts class, interface, method, field, route, service, and repository annotations with `file/line` ranges and `calls[]`; call-edge parsing starts with same-file explicit calls, then adds a limited cross-layer route-chain milestone; unresolved edges become Static Analysis Break, never guessed.
- Config evidence: deterministic config key extraction reads `application*.yml`, `application*.properties`, and `pom.xml`; answers expose key names and locations, not values, with values masked per ADR-0003.
- Security gates: secret masking and `/file/raw` path traversal protection are hard prerequisites before any real LLM call or frontend rendering; masking covers passwords, tokens, API keys, AK/SK, and private keys, and unit-testable masking logs a minimal masked event.
- Query loop: SSE server streams `token`, `mermaid`, `anchors`, and `done`, reusing the existing EventBus and server event union; tool calls use `RepoQARepos` search/symbol/call-chain queries with prompt context capped at 8K tokens.
- LLM integration: configuration comes only from environment variables; a mock LLM adapter validates the SSE contract first, then the real adapter is wired after masking and golden eval gates pass, per ADR-0004.
- Suggested action: query done events may include an optional static `suggested_action` derived from real symbols or the next unresolved hop; it must not invent Quick Tours or playlists.
- Local evidence plane: add a read-only local `repoqa_events` table with minimal events for query start/done, tool miss, anchor click, feedback, and failure classification; no uploads and no user identity beyond optional session/role metadata.
- Golden dataset: freeze 50 questions (20 route chain, 15 config, 15 architecture), fixed repo commits, ground-truth anchors, K, match rules, failure taxonomy, and per-bucket thresholds; config bucket counts only after deterministic config extraction exists.
- Limits and recovery: hard cap at 3,000 files / 500K LOC with submodule guidance; re-index is idempotent; repo status and data recover after restart.
- Latency: target first-token at 1.2s and hard gate at 1.5s on local LLM; Phase 2 will measure browser render latency separately.

## Testing Decisions

- Test at the single confirmed seam: the Control Plane HTTP API boundary, using in-memory SQLite and a small Java fixture repo, so tests assert user-observable behavior rather than parser internals.
- Coverage: POST import returns 201; status transitions to ready/error; symbol listing returns extracted routes/classes/methods; SSE emits the expected event order; invalid anchors are not emitted; raw-file path traversal returns 403; masking is applied before any LLM call and in rendered config answers; re-index is idempotent; restart recovers state.
- Golden eval harness: frozen repo/commit/question set with human-verified ground truth; outputs per-bucket Recall@K, line hallucination rate, valid anchor rate, first-token latency, and failure taxonomy; Recall@K >= 85%, hallucination <= 2%, anchor validity >= 90%.
- Prior art: the control plane package already uses Vitest and better-sqlite3; no existing RepoQA integration tests exist, so this spec establishes the first HTTP-level integration suite on that runtime.

## Out of Scope

- GitHub URL cloning, TypeScript/Node.js parsing, mixed-language repo indexing, semantic embeddings, and FTS/vector search.
- Phase 2 web workbench, Monaco, Mermaid rendering UI, Quick Tours, slash commands as primary entry, and export features.
- Phase 3 onboarding dashboard, commit-hash cache, PNG/PDF export, mentor-intervention tracking, and North Star metrics.
- Tech-lead reverse-dependency impact analysis as a product promise, SSO, multi-tenant SaaS, remote sync, dynamic runtime tracing, and code write-back.

## Further Notes

- This spec is derived from `docs/repoqa-review.md` and ADR-0001..0004; device against those documents when implementation conflicts arise.
- Use RepoPulse Glossary vocabulary defined in `CONTEXT.md` (RepoPulse, Repo Index, AST Symbol, Call Edge, Call Chain, Anchor, Static Analysis Break, Chunk, Sensitive Context Masking, Evidence Plane, Golden Dataset, Recall@K).
- Review report Phase 1 delivery order is the implementation sequence; do not start real LLM prompt tuning before golden eval and masking gates pass.
- Original `docs/repoqa-prd.md` and `docs/repoqa-plan.md` remain unmodified; this spec is the actionable backlog source for Phase 1.
