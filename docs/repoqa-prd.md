# RepoPulse — Code Repository Q&A Workbench

## 1. Product Overview

RepoPulse is a **read-only code intelligence workbench** built on top of Multi-Harness Workbench. It helps new developers go from "cloned repo" to "first meaningful PR" in the shortest possible time, by replacing manual code search and mentor interruptions with deterministic AST-based call-chain analysis, interactive architecture diagrams, and one-click source navigation.

### 1.1 North Star Metrics
- **TTFP (Time-to-First-PR)**: reduce onboarding time by surfacing architecture, config, and business flows in minutes instead of days.
- **Self-Service Adoption Rate**: % of onboarding questions answered without mentor intervention.
- **Valid Anchor Rate**: % of code-line references that map to real, existing lines.
- **Hallucination Rate**: % of fabricated class/method/line references (target ≤ 2%).
- **First-Token Latency**: ≤ 1.5s for streaming answers.

## 2. Users & Jobs-to-be-Done

| User Segment | Core JTBD |
|---|---|
| Backend/full-stack devs (1–30 days in) | Understand module boundaries, trace a request end-to-end, and find the exact code for a business concept. |
| Tech leads / architects | Quickly review cross-module dependency for impact analysis before accepting a PR. |
| New hires during onboarding | Skip days of README archaeology and get a structured walkthrough of the repo. |

## 3. Value Proposition

> Input an API endpoint or business noun; in seconds, get a deterministic call-chain diagram and clickable source anchors from Controller to DB/RPC.

The key differentiator vs. generic code search:
- **Deterministic symbol resolution** via AST (Tree-sitter / JavaParser), not semantic similarity.
- **Multi-modal answer**: structured text + Mermaid sequence diagram + source evidence cards.
- **Zero-prompt onboarding**: proactive Playlists generated after indexing, not blank chat.

## 4. In Scope (MVP)

- Java (Spring Boot) OR TypeScript/Node.js, single-language per repo
- Static AST parsing for classes, methods, annotations, routes
- Symbol table + call edges persisted in SQLite
- Local folder import and single GitHub repo clone (main branch)
- SSE streaming answers with strict 3-part output format
- Mermaid sequence diagram with `code://` deep links
- Monaco Editor read-only preview with line reveal and glow animation
- Basic route list and file/symbol tree sidebar

## 5. Out of Scope (MVP)

- Multi-language mixed parsing
- Dynamic tracing (SkyWalking/OpenTelemetry)
- Code generation, refactoring, or write-back
- Multi-branch diff and real-time sync
- Team collaboration / multi-tenant SaaS
- Enterprise SSO and network-isolated deployment (post-MVP)

## 6. Information Architecture

```
RepoPulse Workbench
├── Top Bar
│   ├── Repo selector (name, branch, commit hash)
│   ├── Index status stepper (Cloning → Parsing AST → Graph Ready)
│   └── Export center (Markdown / architecture image)
├── Left Sidebar
│   ├── Quick Tours (onboarding playlists)
│   ├── Route list (REST endpoints)
│   └── File/symbol tree (file → class → method)
├── Main Canvas
│   ├── Chat stream (user + structured assistant reply)
│   ├── Interactive Mermaid diagram (clickable nodes)
│   └── Source trace drawer (anchored code cards)
└── Right Inspector
    ├── Monaco Editor (read-only, syntax-highlighted)
    ├── Line reveal + glow decorator
    └── Navigation history stack (back/forward)
```

## 7. User Journeys

### 7.1 Day 1 — Environment & Big Picture
**As-Is**: README is outdated; devs spend hours setting up dependencies and reverse-engineering module structure.

**To-Be**:
1. Import local repo or paste GitHub URL.
2. Wait for index stepper to reach Ready (with current package progress).
3. Auto-generated **Onboarding Dashboard** appears:
   - Tech stack extracted from `pom.xml` / `package.json`
   - Module responsibilities
   - Middleware dependencies (DB, MQ, cache)
   - Key API list

### 7.2 Day 3 — Business Cognition
**As-Is**: Blank chat, unsure what to ask; mentor repeatedly interrupted.

**To-Be**:
1. System surfaces **Quick Tours** (top 3 recommended flows).
2. Click a tour card → pre-filled question fires and returns:
   - 100-word process summary
   - Mermaid sequence diagram
   - Source evidence cards with line anchors

### 7.3 Day 7 — Requirement Tracing
**As-Is**: Ctrl+Shift+F keyword search, manually tracing cross-layer calls.

**To-Be**:
1. Ask: "Trace the create-order call chain."
2. Receive deterministic diagram with Controller → Service → Mapper → DB.
3. Click any node in the diagram → Monaco scrolls to exact line with glow highlight.

### 7.4 Day 14 — PR Impact Analysis
**As-Is**: Changing a shared class breaks downstream modules; Code Review catches it late.

**To-Be**:
1. Query: "Who depends on `OrderService`?"
2. Receive reverse dependency graph and downstream module list.
3. Export impact summary to Markdown/PDF for PR description.

## 8. Functional Requirements

### FR-1 Repo Import & Indexing
- Accept local path or GitHub URL.
- Async indexing with SSE progress events: `cloning → parsing → embedding → ready`.
- Show active scanning package/module when duration > 5s.
- Hard cap: 3,000 files / 500K LOC. Prompt user to select sub-module if exceeded.

### FR-2 Symbol Extraction
- Extract:
  - `@RestController` / `@RequestMapping` routes
  - `@Service`, `@Repository`
  - class/interface declarations, method signatures, fields
- Persist `repo_symbols` with `calls[]` edges.
- Index comments/docstrings/README into `repo_chunks` for semantic retrieval.

### FR-3 Structured Multi-Modal Q&A
Input:
- Free-form question
- Slash-command hints: `/trace`, `/api`, `/explain`, `/who-uses`

Output (enforced schema):
1. **Business Logic Overview**: ≤ 100 words.
2. **Mermaid Sequence Diagram**:
   - Participants use real class/method names.
   - Deep links use `code://<FilePath>#<StartLine>-<EndLine>`.
3. **Source Evidence Chain**: 2–4 code cards with exact file:line.

### FR-4 Graph-to-Code Linkage
- Mermaid `click` events intercepted and routed to Monaco.
- Monaco loads file via `/api/repos/:id/file/raw?path=...`.
- Reveal lines in center with 1.5s amber glow animation.
- Breadcrumb updates; push to nav history stack.

### FR-5 Onboarding Dashboard
After index reaches Ready, generate:
- Tech stack table
- Module responsibility table
- Core API list
- Environment dependencies (ports, middleware, config keys)
- Sensitive config masked (passwords, AK/SK).

### FR-6 Export
- Export dashboard to Markdown.
- Export architecture diagram to PNG (Mermaid CLI / SVG snapshot).

## 9. Non-Functional Requirements

### NFR-1 Streaming & Resilience
- SSE first-token latency ≤ 1.2s.
- On disconnect, keep rendered content and retry with exponential backoff (3 attempts).
- Mermaid syntax errors degrade to plain code block; no white screen.

### NFR-2 Performance
- Graph lookup via SQLite BFS/DFS in milliseconds; no brute-force full-repo vector scan for chain queries.
- Monaco virtual scrolling for files ≥ 5,000 lines; disable minimap.
- Frontend LRU cache for up to 50 files.

### NFR-3 Security
- `/api/repos/:id/file/raw` path-traversal protection.
- Mask secrets before sending code context to LLM.
- No code modification endpoints in MVP.

### NFR-4 Local-First
- Control Plane + parser run locally by default.
- Support `OPENAI_BASE_URL` / Ollama / vLLM via `.env`.
- Zero hardcoded credentials.

## 10. Technical Architecture

### 10.1 Backend (Control Plane Extension)
- **Schema**: `repos`, `repo_symbols`, `repo_chunks` in SQLite.
- **Repository**: `RepoQARepos` class with CRUD + search + recursive CTE call-chain.
- **Worker**: `RepoQAWorker` with `startIndex()` and `startQuery()`.
- **Events**: reuse existing `EventBus` and `ServerEvent` union.
- **HTTP**: Express routes under `/api/repos/*` plus SSE query stream.

### 10.2 Frontend (repoqa-web)
- Vite + React + Tailwind.
- Monaco Editor for code inspection.
- Mermaid.js for diagrams.
- `EventSource` for streaming answers.
- Zustand or React state for repo/chat/inspector stores.

### 10.3 Data Flow
```
User question
  → Client SSE `/api/repos/:id/query?q=...`
  → Worker intent routing
  → Tool calls: findSymbol / getCallChain / searchChunks
  → Strict prompt assembly (token-budget ≤ 8K)
  → LLM response with structured anchors
  → SSE streamed back: tokens / mermaid / anchors
  → Client renders Markdown + Mermaid + Source cards
```

## 11. Eval Framework

### 11.1 Golden Dataset (MVP Gate)
- 3 baseline repos: Spring PetClinic, RuoYi, Mall.
- 50 questions:
  - 20 route chain questions
  - 15 config inference questions
  - 15 architecture questions

### 11.2 Acceptance Thresholds
- **Recall@K for call chains**: ≥ 85%
- **Line hallucination rate**: ≤ 2%
- **Valid anchor rate**: ≥ 90%
- **First-token latency**: ≤ 1.5s

### 11.3 CI Checks
- Lint + typecheck pass.
- Unit tests for `RepoQARepos` ≥ 80% coverage.
- Golden dataset regression test on every indexer/LLM prompt change.

## 12. Roadmap

### Phase 1 — Indexing Closed Loop (Week 1–2)
- Contracts + schema + repoqa-repos + repoqa-worker skeleton
- Tree-sitter symbol extraction for Java or TypeScript
- `/api/repos` REST + SSE query
- Sensitive config masking

**Gate**: Import a sample repo → route list populated → SSE query returns Markdown + Mermaid + anchors.

### Phase 2 — Three-Pane Web Workbench (Week 3–4)
- Top Bar stepper
- Sidebar Quick Tours + routes + symbol tree
- Main canvas with streaming Markdown + Mermaid + source drawer
- Right Monaco inspector with `code://` deep links + glow animation
- SSE reconnect + Mermaid error fallback

**Gate**: Open workbench → import repo → click Quick Tour → diagram renders → click node → Monaco highlights line.

### Phase 3 — Onboarding Cockpit (Week 5–6)
- Auto-generated onboarding dashboard
- Markdown/PNG export
- Commit-hash caching → instant re-open of same repo state
- Golden dataset CI gate

**Gate**: Re-open cached repo < 200ms; export offline-readable Markdown; golden tests pass.

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| AST parsing complexity across versions | Start with one stable language/version; defer multi-language. |
| LLM hallucination despite tool use | Enforce strict prompt contract; require anchors; mask unknowns. |
| Large repo performance | Hard 3K file cap; sub-module selection; token budget ≤ 8K. |
| Mermaid rendering fragility | Skeleton placeholder until complete; syntax error fallback. |

## 14. Success Metrics (Launch)

- Golden dataset recall ≥ 85%, hallucination ≤ 2%.
- First-token latency ≤ 1.5s on local LLM.
- Indexing time for 500-file repo < 30s.
- 100% of MVP user journeys (Day 1 / 3 / 7 / 14) executable without mentor.
