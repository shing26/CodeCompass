# RepoPulse — Implementation Plan & Technical Architecture

## 1. Goal

Deliver a working Phase 1 closed loop: import a repo → AST symbol extraction → SQLite persistence → SSE query → structured Markdown/Mermaid/anchors response.

## 2. Repository Layout

```
D:/multi-harness-workbench/
├── packages/
│   └── contracts/src/
│       ├── index.ts          # re-exports v1 + repoqa
│       └── repoqa.ts         # RepoQA data contracts
├── services/
│   └── control-plane/src/
│       ├── types.ts          # TaskType + ServerEvent union extended
│       ├── db.ts             # SQLite schema extension
│       ├── repoqa-repos.ts   # Repo + RepoSymbol + RepoChunk DAO
│       ├── repoqa-worker.ts  # Index/query worker with SSE events
│       ├── http.ts           # Express routes + SSE endpoint
│       └── index.ts          # bootstrap (integrate RepoQA routes)
└── apps/
    └── repoqa-web/           # Phase 2: standalone React/Vite workbench
```

## 3. Data Contracts

File: `packages/contracts/src/repoqa.ts`

```ts
export type RepoQATaskType = 'repoqa.index' | 'repoqa.query';

export interface IndexJobInput {
  repoUrl?: string;
  localPath: string;
  branch?: string;
  languages?: string[];
}

export interface IndexJobOutput {
  status: 'cloning' | 'parsing' | 'embedding' | 'ready' | 'error';
  repoId: string;
  fileCount: number;
  symbolCount: number;
  error?: string;
}

export interface QueryJobInput {
  repoId: string;
  question: string;
  mode?: 'architecture' | 'call-chain' | 'environment';
}

export interface QueryJobOutput {
  answer: string;
  mermaid?: string;
  anchors?: Array<{ file: string; line: number; symbol: string }>;
  trace?: Array<{ file: string; method: string; line: number }>;
}
```

Extend `services/control-plane/src/types.ts`:
```ts
export type TaskType = 'coding' | 'shell' | 'browser' | 'repoqa.index' | 'repoqa.query';

export type ServerEvent =
  | { type: 'task.created'; payload: Task }
  | { type: 'task.updated'; payload: Task }
  | { type: 'harness.connected'; payload: Harness }
  | { type: 'harness.disconnected'; payload: Harness }
  | { type: 'log.chunk'; payload: { taskId: string; stream: string; text: string } }
  | { type: 'token.usage'; payload: { taskId: string; input: number; output: number } }
  | { type: 'approval.requested'; payload: { taskId: string; reason: string } }
  | { type: 'approval.resolved'; payload: { taskId: string; approved: boolean } }
  | { type: 'repoqa.index.progress'; payload: { repoId: string; phase: string; detail?: string } }
  | { type: 'repoqa.index.done'; payload: { repoId: string; status: string; fileCount: number; symbolCount: number } }
  | { type: 'repoqa.index.error'; payload: { error: string } }
  | { type: 'repoqa.query.done'; payload: Record<string, unknown> }
  | { type: 'repoqa.query.error'; payload: { error: string } };
```

## 4. Database Schema

File: `services/control-plane/src/db.ts`

Append to `SCHEMA`:

```sql
CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_url TEXT,
  local_path TEXT NOT NULL,
  branch TEXT DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'idle',
  file_count INTEGER NOT NULL DEFAULT 0,
  symbol_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  signature TEXT,
  calls TEXT,
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);
CREATE INDEX IF NOT EXISTS idx_repo_symbols_repo ON repo_symbols(repo_id, kind, name);

CREATE TABLE IF NOT EXISTS repo_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  content TEXT NOT NULL,
  file_path TEXT,
  line_start INTEGER,
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);
CREATE INDEX IF NOT EXISTS idx_repo_chunks_repo ON repo_chunks(repo_id, chunk_type);
```

## 5. Repository Layer

File: `services/control-plane/src/repoqa-repos.ts`

Exports:
- `Repo` — repo metadata and status
- `RepoSymbol` — class/method/route/field/ config symbol with optional `calls[]`
- `RepoChunk` — comment/readme/docstring chunk for semantic search

Key methods:
- `createRepo(input): Repo`
- `getRepo(id): Repo | undefined`
- `listRepos(): Repo[]`
- `updateRepoStatus(id, status, fileCount?, symbolCount?): void`
- `upsertSymbols(symbols: RepoSymbol[]): void` — transaction-safe replace
- `listSymbols(repoId, kind?): RepoSymbol[]`
- `upsertChunks(chunks: RepoChunk[]): void`
- `searchChunks(repoId, query, limit?): RepoChunk[]` — LIKE fallback; replace with FTS later
- `findSymbol(repoId, name, kind?): RepoSymbol[]`
- `getCallChain(repoId, filePath, methodName, depth?): Array<{file, method, line}>` — recursive CTE BFS

## 6. Worker Layer

File: `services/control-plane/src/repoqa-worker.ts`

Class `RepoQAWorker`:
- `constructor(repoqa: RepoQARepos, eventBus: EventBus)`
- `startIndex(taskId, input): Promise<void>`
  - Creates repo record
  - Emits `repoqa.index.progress` for cloning/parsing/embedding
  - Calls `parseRepo()` (Tree-sitter) and `extractChunks()`
  - Emits `repoqa.index.done` or `repoqa.index.error`
- `startQuery(taskId, input): Promise<void>`
  - Runs `runReActLoop()` for tool-augmented LLM reasoning
  - Emits `repoqa.query.done` or `repoqa.query.error`
- `cancel(taskId): void`

## 7. HTTP & SSE Layer

File: `services/control-plane/src/http.ts`

New routes:
- `GET /api/repos` — list repos
- `POST /api/repos` — create repo and start indexing
- `GET /api/repos/:id/symbols?kind=...` — list symbols
- `GET /api/repos/:id/query?q=...&mode=...` — SSE stream for answers
- `GET /api/repos/:id/file/raw?path=...` — raw file download for Monaco

SSE contract:
```
event: token
data: {"text":"..."}

event: mermaid
data: {"code":"sequenceDiagram..."}

event: anchors
data: {"anchors":[{"file":"...","line":12,"symbol":"..."}]}

event: done
data: {}
```

## 8. Bootstrap Integration

File: `services/control-plane/src/index.ts`

Current implementation uses raw `http.createServer`. For Phase 1, wire RepoQA routes into this server or migrate to Express:

Minimal patch:
```ts
import { createHttpApp } from './http';
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';

const repoqa = new RepoQARepos(storage.db);
const repoQAWorker = new RepoQAWorker(repoqa, eventBus);
const app = createHttpApp({ repos, orchestrator, registry, version: '0.1.0', dataDir, port, exportDir });

// RepoQA routes
app.get('/api/repos', (_req, res) => res.json({ repos: repoqa.listRepos() }));
app.post('/api/repos', express.json(), (req, res) => { /* startIndex */ });
app.get('/api/repos/:id/symbols', (req, res) => { /* listSymbols */ });
app.get('/api/repos/:id/query', (req, res) => { /* SSE query */ });
app.get('/api/repos/:id/file/raw', (req, res) => { /* raw file */ });

server.on('request', app);
```

## 9. Phase 1 Verification

### 9.1 Scripted Checks

```bash
# 1. Typecheck
cd services/control-plane && npm run typecheck

# 2. Unit tests
npm run test

# 3. Start server
npm run dev

# 4. Import repo
curl -X POST http://localhost:20128/api/repos \
  -H 'content-type: application/json' \
  -d '{"name":"petclinic","localPath":"C:/projects/spring-petclinic"}'

# 5. Poll status
curl http://localhost:20128/api/repos | jq '.repos[].status'

# 6. Query (SSE)
curl "http://localhost:20128/api/repos/<id>/query?q=/owners 经过了哪些类&mode=call-chain" \
  -H 'accept: text/event-stream'
```

### 9.2 Checklist
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] Import returns 201 with repo object
- [ ] Status transitions through `idle → indexing → ready`
- [ ] `/symbols?kind=route` returns non-empty array for Spring PetClinic
- [ ] SSE returns `token`, `mermaid`, `anchors`, `done` events
- [ ] `/file/raw?path=../secret.txt` returns 403
- [ ] `OPENAI_BASE_URL` loaded from `.env`, no hardcoded URLs

## 10. Frontend Plan (Phase 2)

### 10.1 Tech Stack
- Vite + React 19 + TypeScript
- Tailwind CSS
- Monaco Editor (`@monaco-editor/react`)
- Mermaid.js (`mermaid`)

### 10.2 State Shape

```ts
interface RepoState {
  repo: Repo | null;
  symbols: RepoSymbol[];
  setRepo: (repo: Repo) => void;
}

interface ChatState {
  messages: Message[];
  streaming: boolean;
  append: (msg: Message) => void;
}

interface InspectorState {
  file: string | null;
  text: string;
  navStack: Array<{ file: string; line: number }>;
  openFile: (file: string, lineRange?: [number, number]) => void;
}
```

### 10.3 Key Components
- `TopBar`: repo selector, stepper, export button
- `Sidebar`: Quick Tours, route list, symbol tree
- `Canvas`: chat stream + Mermaid renderer + Source Trace drawer
- `Inspector`: Monaco with `code://` handler and glow decorator

### 10.4 Interactions
1. Click Quick Tour → auto-submit prompt to `/api/repos/:id/query`
2. SSE `token` → append to Markdown
3. SSE `mermaid` → render Mermaid
4. SSE `anchors` → show Source Trace drawer
5. Click diagram node `click X "code://path#L1-L2"` → `window.postMessage` → Inspector opens + reveals lines
6. Inspector nav stack supports back/forward

## 11. Non-Functional Implementation Notes

### 11.1 Secret Masking
Before sending code chunks to LLM, apply regex masks:
```ts
const SECRET_PATTERNS = [
  /(password|passwd|pwd)\s*[:=]\s*.+/gi,
  /(api[_-]?key|apikey|token|secret)\s*[:=]\s*.+/gi,
  /(AK|SK)[a-zA-Z0-9]{20,}/g,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/
];
```

### 11.2 Token Budget
- Class/interface signatures preserved
- Target method body expanded
- Unrelated methods collapsed to single-line signatures
- Hard cap: prompt context ≤ 8,000 tokens

### 11.3 Error Boundaries
- Mermaid parse error → show raw code block with syntax-highlight
- SSE disconnect → keep rendered content, retry 3× with backoff
- AST parse failure → repo status `error` + detail message

## 12. Golden Dataset (MVP Gate)

Repos:
1. `spring-petclinic` (Java, Spring Boot)
2. `RuoYi-Vue` (Java backend)
3. `mall` (Java, Spring Boot)

50 questions:
- 20 route chain: `/api/xxx 经过哪些类`
- 15 config inference: `Redis 连接池在哪里配`
- 15 architecture: `全局异常处理在哪层`

Thresholds:
- Recall@K ≥ 85%
- Line hallucination ≤ 2%
- Valid anchor rate ≥ 90%

## 13. Phase 3 Preview

- Auto-generated onboarding dashboard
- Tech stack/module/env extraction
- Markdown/PNG export
- Commit-hash cache for instant re-open
- Golden dataset CI regression gate

## 14. Phase 4 Extension Notes

Phase 4 is an iterative post-release batch driven by dogfooding feedback and agent rollout. It extends the deterministic Read-Only closed loop without relaxing the "zero-LLM for call-chain/tours/dashboard/diff" rule.

- **Usability & UX hotfixes (Issue 18)**: `cleanLocalPath`, scan ignore expansion, Sidebar symbol-tree navigation, Chinese fuzzy start matching, offline empty-state guidance.
- **Repository Ingestion Hub (Issue 19)**: local visual catalog picker + safe GitHub shallow clone (`--depth 1`, 60s timeout, traversal guards).
- **MCP server export (Issue 20)**: `codecompass mcp <path>` stdio server with 4 tools, NDJSON framing, logs on stderr.
- **Record + Spring Bean disambiguation (Issue 21)**: etc-length record patch, component read-only field/accessor symbols, Bean ambiguity resolved by `@Qualifier/@Resource(name)` → `@Primary` → field/parameter name match → Static Analysis Break.
- **PR impact diff CLI (Issue 22)**: `codecompass diff <base> <head> [repoPath]` performs read-only git analysis, reverse BFS from affected symbols to `@RestController`, config key change detection, Mermaid impact graph, and Markdown/JSON output.

**Phase 4 verification**: backend test suite (`268/268`), frontend test suite (`120/120` with forks pool), golden eval (`50/50`), and Issue 22 diff CLI manual demo all pass in local testing.

## 15. Quick Start (Developer)

```bash
# 1. Clone MHW and install
git clone <mhw-repo>
cd multi-harness-workbench
npm run install:all

# 2. Start Control Plane
cd services/control-plane
cp .env.example .env   # set OPENAI_API_KEY or OPENAI_BASE_URL
npm run dev

# 3. Import a Java repo
curl -X POST http://localhost:20128/api/repos \
  -H 'content-type: application/json' \
  -d '{"name":"petclinic","localPath":"C:/projects/spring-petclinic"}'

# 4. Query
curl "http://localhost:20128/api/repos/<id>/query?q=/owners 经过哪些类&mode=call-chain" \
  -H 'accept: text/event-stream'
```
