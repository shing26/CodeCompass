# CodeCompass — Agent Handoff Document

## 1. Project Identity

**Name**: CodeCompass (internal codename: RepoPulse)  
**Purpose**: Read-only code intelligence workbench for new-developer onboarding and architecture Q&A.  
**Built on**: Multi-Harness Workbench (MHW) — Control Plane (Node/TS + SQLite) + future standalone web frontend.  
**Location**: `D:/CodeCompass`  
**Original source**: `D:/multi-harness-workbench`  

## 2. What Was Completed

### 2.1 Code Changes
- `packages/contracts/src/repoqa.ts` — RepoQA data contracts (index/query I/O)
- `packages/contracts/src/index.ts` — re-exports `repoqa.ts`
- `services/control-plane/src/types.ts` — added `repoqa.index | repoqa.query` to `TaskType`; extended `ServerEvent` union
- `services/control-plane/src/db.ts` — SQLite schema: `repos`, `repo_symbols`, `repo_chunks` + indexes
- `services/control-plane/src/repoqa-repos.ts` — `RepoQARepos` DAO with CRUD, LIKE search, recursive CTE call-chain
- `services/control-plane/src/repoqa-worker.ts` — `RepoQAWorker` class with `startIndex()` and `startQuery()` skeletons emitting SSE events

### 2.2 Documentation
- `docs/repoqa-prd.md` — full PRD (users, JTBD, IA, FR, NFR, Eval, roadmap)
- `docs/repoqa-plan.md` — technical architecture, data flow, API contracts, verification gates, frontend plan

### 2.3 Current State
- Contracts are schema-first and type-checked.
- Database schema is ready; new tables will be created automatically on next Control Plane startup.
- Repository layer compiles and has working SQL for insert/search/call-chain.
- Worker layer compiles but `parseRepo`, `extractChunks`, and `runReActLoop` are stubbed (TODO).

## 3. What Remains (Exact Next Steps)

### Step 1 — Wire RepoQA Routes into Bootstrap
File: `services/control-plane/src/index.ts`

Currently, `index.ts` is the raw `http.createServer` + WebSocket demo. You need to:
1. Import `createHttpApp` from `./http`.
2. Instantiate `RepoQARepos` and `RepoQAWorker`.
3. Build the Express app with existing deps + `repoqa` + `worker`.
4. Mount RepoQA routes:
   - `GET /api/repos`
   - `POST /api/repos`
   - `GET /api/repos/:id/symbols`
   - `GET /api/repos/:id/query` (SSE)
   - `GET /api/repos/:id/file/raw`
5. Make `server` use `app` for requests while keeping existing `/health`, `/harnesses` routes working.

Reference: `docs/repoqa-plan.md` Section 8 has the exact wiring snippet.

### Step 2 — Implement Tree-sitter Symbol Extraction
Files to create/modify:
- `services/control-plane/src/repoqa-worker.ts` → `parseRepo()`

Recommended approach for MVP (Java Spring Boot):
- Use `tree-sitter` CLI via `child_process.execFile` to parse `.java` files.
- Extract:
  - `@RestController` / `@RequestMapping` → `kind=route`, `signature=HTTP METHOD path`
  - `@Service`, `@Repository` → `kind=class`
  - class declarations → `kind=class`
  - method declarations → `kind=method`
  - `calls[]` — resolve simple identifier references within method body
- Stop at 3,000 files; emit `repoqa.index.error` with guidance if exceeded.

### Step 3 — Implement Chunk Extraction
File: `services/control-plane/src/repoqa-worker.ts` → `extractChunks()`

- Collect `README*.md`, `*.md` in root, and all Java doc comments.
- Split into ~800-token chunks.
- Persist as `RepoChunk` via `repoqa.upsertChunks()`.

### Step 4 — Implement ReAct Loop + LLM Integration
File: `services/control-plane/src/repoqa-worker.ts` → `runReActLoop()`

- Intent routing: classify user question into `architecture | call-chain | environment`.
- Tool calling: let LLM call `findSymbol`, `getCallChain`, `searchChunks` on `RepoQARepos`.
- Strict prompt: no guessing; if chain breaks, emit `⚠️ 静态分析在此处中断`.
- Stream SSE events back: `token`, `mermaid`, `anchors`, `done`.

LLM config must come from `.env`:
- `OPENAI_API_KEY` or `OPENAI_BASE_URL` (for Ollama/vLLM)
- No hardcoded URLs in code.

### Step 5 — Add Sensitive Config Masking
Before any code context is sent to the LLM, apply:
```ts
const SECRET_PATTERNS = [
  /(password|passwd|pwd)\s*[:=]\s*.+/gi,
  /(api[_-]?key|apikey|token|secret)\s*[:=]\s*.+/gi,
  /(AK|SK)[a-zA-Z0-9]{20,}/g,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g
];
```

### Step 6 — Validation & Golden Dataset
Repos to test:
1. `spring-petclinic` (Java)
2. `RuoYi-Vue` backend (Java)
3. `mall` (Java)

Run 50-question golden dataset (20 route chain, 15 config, 15 architecture).  
Pass thresholds:
- Recall@K ≥ 85%
- Line hallucination ≤ 2%
- Valid anchor rate ≥ 90%
- First-token latency ≤ 1.5s

## 4. Architecture Reminders

### 4.1 Key Design Decisions
- **Local-first**: Control Plane runs on `localhost:20128` by default.
- **Schema-first**: All shapes in `packages/contracts/src/repoqa.ts`. Do not invent ad-hoc types in worker/http.
- **Read-only**: No write-back to source repo. AST parsing is read-only.
- **Token budget**: Prompt context ≤ 8,000 tokens. Agent uses ReAct tool loops, never whole-file injection.
- **Event reuse**: All RepoQA progress/answers flow through existing `EventBus` + `ServerEvent` union.

### 4.2 Important Paths
- Contracts: `D:/CodeCompass/packages/contracts/src/`
- Control Plane: `D:/CodeCompass/services/control-plane/src/`
- Docs: `D:/CodeCompass/docs/`

### 4.3 Existing MHW Patterns to Follow
- Use `better-sqlite3` with WAL mode (already configured in `db.ts`).
- Use `express` for HTTP, `ws` for WebSocket (already in `package.json`).
- `RepoQARepos` methods should mirror style of existing `Repos` class in `repos.ts`.
- Worker should mirror event-emission pattern of `Orchestrator`.

## 5. Quick Verification Checklist

```bash
cd D:/CodeCompass/services/control-plane

# 1. Install deps if needed
npm install

# 2. Typecheck
npm run typecheck

# 3. Run tests
npm run test

# 4. Start Control Plane
npm run dev

# 5. Import repo
curl -X POST http://localhost:20128/api/repos \
  -H 'content-type: application/json' \
  -d '{"name":"petclinic","localPath":"C:/projects/spring-petclinic"}'

# 6. Poll status
curl http://localhost:20128/api/repos | jq '.repos[].status'

# 7. Query (SSE)
curl "http://localhost:20128/api/repos/<id>/query?q=/owners 经过哪些类&mode=call-chain" \
  -H 'accept: text/event-stream'
```

## 6. Frontend (Phase 2) Brief

When backend Phase 1 is solid, build `apps/repoqa-web/`:
- Vite + React 19 + TS + Tailwind
- Monaco Editor (`@monaco-editor/react`)
- Mermaid.js (`mermaid`)
- Three-pane layout: TopBar + Sidebar + Canvas + Right Inspector
- SSE client via `EventSource`
- `code://` protocol for diagram-to-code linking

Reference: `docs/repoqa-prd.md` Section 6 (IA) and `docs/repoqa-plan.md` Section 10 (Frontend Plan).

## 7. Environment & Config

Create `D:/CodeCompass/.env` when ready for LLM integration:
```
OPENAI_API_KEY=...
OPENAI_BASE_URL=...
CONTROL_PLANE_PORT=20128
```

Never commit `.env` to version control.

## 8. Handoff Checklist for Next Agent

- [ ] Read `docs/repoqa-prd.md` for product context.
- [ ] Read `docs/repoqa-plan.md` for technical plan.
- [ ] Wire `index.ts` per Step 1 above.
- [ ] Implement `parseRepo()` with Tree-sitter for Java.
- [ ] Implement `extractChunks()`.
- [ ] Implement `runReActLoop()` with tool calling.
- [ ] Add secret masking regex before LLM calls.
- [ ] Run golden dataset; ensure Recall@K ≥ 85%, hallucination ≤ 2%.
- [ ] Only after Phase 1 gates pass, start Phase 2 frontend.

## 9. Contact / Context

- User preference: Chinese replies, English code/CLI.
- Host: Windows 10/11, Hermes desktop, bash shell available.
- Do not modify MHW original at `D:/multi-harness-workbench`; all work is in `D:/CodeCompass`.
- For questions about existing MHW architecture patterns, inspect `D:/multi-harness-workbench` source.
