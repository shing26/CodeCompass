import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvolveStreamLike, RepoQAClient } from '../client/RepoQAClient';
import { parseEvidenceFromAnswer } from '../components/evidence';
import type {
  Anchor,
  ConventionConflictDetail,
  EvolutionIntentEcho,
  EvidenceItem,
  ModuleEvolutionResult,
  Repo,
  TokenUsage,
  WorkbenchCardRow
} from '../types';

/**
 * Issue 25 / Ticket 03 — temporary client-side id for an in-flight delivery.
 * The server mints the durable id at persist time and the terminal SSE
 * payload discloses it (cardId); this only needs to be unique locally.
 * crypto.randomUUID exists in secure contexts — plain-http LAN origins and
 * some test environments fall back to a random suffix.
 */
function newTempCardId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `temp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Issue 24 / Ticket 24.5 — one artifact card in the investigation stream:
 * a delivered intent plus everything the evolve run produced for it.
 */
export interface EvolutionCard {
  kind: 'evolve';
  id: string;
  /** The raw intent text as delivered (echo of the submission). */
  intent: string;
  /** Explicit target override (Correction-Pill re-submit), if any. */
  target?: string;
  status: 'streaming' | 'done' | 'error';
  stages: Record<string, 'running' | 'done'>;
  echo: EvolutionIntentEcho | null;
  result: ModuleEvolutionResult | null;
  mermaid: string | null;
  /** Physical commit the artifacts were minted against (ADR-0012). */
  commit: string | null;
  error: string | null;
  conflict: ConventionConflictDetail | null;
}

/**
 * Issue 25 / Ticket 01 — one incident investigation card in the same
 * (repoId, commit) artifact stream.
 *
 * v1.4.x（2026-10-19 定位裁决）——Web 侧 incident 投递入口已移除（无调用方的
 * 死链）。本类型与 hydrate 路径保留：服务端仍支持 incident（`stack` 参数、
 * query SSE），历史持久化行回放时仍需被解析与识别（EvolutionView 会将其
 * 从演进列表过滤掉）。
 */
export interface IncidentCard {
  kind: 'incident';
  id: string;
  /** Symptom question as delivered (echo of the submission). */
  intent: string;
  /** Pasted stack trace / log excerpt, if any. */
  stack?: string;
  status: 'streaming' | 'done' | 'error';
  /** Accumulated answer text (token events). */
  answer: string;
  anchors: Anchor[] | null;
  diagram: string | null;
  /** Grounded assertions parsed from the answer + anchors once done lands. */
  evidence: EvidenceItem[] | null;
  provenance?: 'static' | 'llm';
  lowConfidence?: boolean;
  usage?: TokenUsage;
  /** Backend-suggested follow-up from the done payload. */
  suggestedAction?: string;
  /** Static Analysis Break — no anchors and no diagram (ticket 06 semantics). */
  break?: boolean;
  commit: string | null;
  error: string | null;
}

/** One card in the append-only workbench stream (evolve or incident). */
export type WorkbenchCard = EvolutionCard | IncidentCard;

export interface UseEvolutionSessionResult {
  /** Artifact cards of the CURRENT (repoId, commit) stream, delivery order. */
  cards: WorkbenchCard[];
  /** True while the latest evolve delivery is still streaming. */
  running: boolean;
  /** Deliver a new intent into the current stream (追问 = another delivery). */
  submit: (intent: string, target?: string) => void;
}

/** v1.4.x — the evolve branch is the only live producer; the query-SSE union
 * member went away with the incident composer (server capability remains). */
type WorkbenchStream = { kind: 'evolve'; stream: EvolveStreamLike };

/** Issue 25 / Ticket 03 — narrow a persisted JSON blob before hydrating it. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Issue 25 / Ticket 03 — map one persisted workbench_cards row back to the
 * stream card the frontend renders. Incident evidence is re-parsed
 * deterministically from the stored answer + anchors (parseEvidenceFromAnswer
 * never invents an assertion), so the replay matches the live card.
 */
function rowToCard(row: WorkbenchCardRow, commit: string | null): WorkbenchCard | null {
  if (row.kind === 'evolve') {
    return {
      kind: 'evolve',
      id: row.id,
      intent: row.intent ?? '',
      ...(row.target ? { target: row.target } : {}),
      status: row.status,
      // Stage chips are a live-stream disclosure; replayed cards start clean.
      stages: {},
      echo: isRecord(row.echo) ? (row.echo as unknown as EvolutionIntentEcho) : null,
      result: isRecord(row.result) ? (row.result as unknown as ModuleEvolutionResult) : null,
      mermaid: row.mermaid ?? null,
      commit,
      error: row.error ?? null,
      conflict: isRecord(row.conflict)
        ? (row.conflict as unknown as ConventionConflictDetail)
        : null
    };
  }
  const result = isRecord(row.result) ? row.result : {};
  const answer = typeof result.answer === 'string' ? result.answer : '';
  const anchors = Array.isArray(result.anchors) ? (result.anchors as Anchor[]) : [];
  const usage = isTokenUsage(result.usage) ? result.usage : undefined;
  const provenance =
    result.provenance === 'llm' || result.provenance === 'static' ? result.provenance : undefined;
  return {
    kind: 'incident',
    id: row.id,
    intent: row.intent ?? '',
    ...(typeof row.echo === 'string' && row.echo ? { stack: row.echo } : {}),
    status: row.status,
    answer,
    anchors: row.status === 'done' ? anchors : null,
    diagram: row.mermaid ?? null,
    evidence: row.status === 'done' ? parseEvidenceFromAnswer(answer, anchors) : null,
    ...(provenance ? { provenance } : {}),
    ...(result.lowConfidence === true ? { lowConfidence: true } : {}),
    ...(usage ? { usage } : {}),
    ...(typeof result.suggestedAction === 'string' ? { suggestedAction: result.suggestedAction } : {}),
    // Ticket 06 semantics: a replayed done card with neither anchors nor a
    // diagram is presented as a break, matching the live onDone fallback.
    ...(row.status === 'done' ? { break: anchors.length === 0 && !row.mermaid } : {}),
    commit: null,
    error: row.error ?? null
  };
}

function isTokenUsage(value: unknown): value is TokenUsage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TokenUsage>;
  return (
    typeof candidate.input === 'number' &&
    typeof candidate.output === 'number' &&
    typeof candidate.total === 'number' &&
    (candidate.source === 'provider' || candidate.source === 'estimate')
  );
}

/**
 * Ticket 24.5 — Artifact Stream session state (ADR-0012): append-only
 * artifact-card timeline bucketed by (repoId, commit). Switching repos or a
 * changed commit (e.g. after re-index; dirty is already encoded by the
 * backend as `hash+dirty`) opens/switches the stream — cards never mix.
 * v1 keeps buckets in memory only; server-side persistence is Issue 25
 * (the `workbench_cards` table).
 *
 * v1.4.x（2026-10-19 定位裁决）— 本 hook 现在只有 evolve 一种投递（POST /evolve
 * SSE）。历史 incident 卡可经 hydrate 回放（服务端仍持久化它们），但 Web 已无
 * 投递入口；同一时刻仍只允许一张卡在流式。
 *
 * Lives at the App level (like useChat) so the stream survives tab switches.
 */
export function useEvolutionSession(
  client: Pick<RepoQAClient, 'evolveStream' | 'queryRepo' | 'getWorkbenchCards'>,
  repo: Repo | null
): UseEvolutionSessionResult {
  const [cards, setCards] = useState<WorkbenchCard[]>([]);
  const [running, setRunning] = useState(false);
  const bucketsRef = useRef(new Map<string, WorkbenchCard[]>());
  const keyRef = useRef('');
  const repoRef = useRef(repo);
  const streamRef = useRef<WorkbenchStream | null>(null);
  const runningIdRef = useRef<string | null>(null);
  const reconnectingRef = useRef(false);
  const recoveredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    repoRef.current = repo;
  }, [repo]);

  /** Patch one card in the current bucket (ref + mirrored state). */
  const patchCard = useCallback((cardId: string, patch: Partial<WorkbenchCard>) => {
    const list = bucketsRef.current.get(keyRef.current) ?? [];
    const next = list.map((card) =>
      card.id === cardId ? ({ ...card, ...patch } as WorkbenchCard) : card
    );
    bucketsRef.current.set(keyRef.current, next);
    setCards(next);
  }, []);

  /**
   * Issue 25 / Ticket 03 — hydrate replay: pull the persisted cards of the
   * (repoId, commit) stream and merge them into the in-memory bucket. Server
   * rows are authoritative for terminal cards (an in-memory twin is dropped
   * when its adopted id already matches); in-memory cards that never reached
   * a terminal SSE event were never persisted and stay. Best-effort: a
   * failed replay keeps the in-memory bucket untouched.
   */
  const hydrateBucket = useCallback(
    async (key: string, repoId: string, commit: string) => {
      try {
        const rows = (await client.getWorkbenchCards(repoId, commit)) ?? [];
        if (keyRef.current !== key) return; // the bucket moved on mid-flight
        const hydrated = rows
          .map((row) => rowToCard(row, commit))
          .filter((card): card is WorkbenchCard => card !== null);
        const hydratedIds = new Set(hydrated.map((card) => card.id));
        const kept = (bucketsRef.current.get(key) ?? []).filter(
          (card) => !hydratedIds.has(card.id)
        );
        const merged = [...hydrated, ...kept];
        bucketsRef.current.set(key, merged);
        setCards(merged);
      } catch {
        // Hydrate is additive replay — never break the live session on it.
      }
    },
    [client]
  );

  // Bucket transition: (repoId, commit) change closes the in-flight stream,
  // persists the previous bucket (interrupted card marked as error) and loads
  // the target bucket. Guarded by keyRef so catalog refreshes that re-create
  // the repo object with an unchanged commit are no-ops.
  const commitKey = repo ? `${repo.id}::${repo.commit ?? 'unknown'}` : '';
  useEffect(() => {
    if (keyRef.current === commitKey) return;
    const previousKey = keyRef.current;
    if (previousKey) {
      const previous = (bucketsRef.current.get(previousKey) ?? []).map((card) =>
        card.status === 'streaming'
          ? { ...card, status: 'error' as const, error: '会话已切换，方案生成中断。' }
          : card
      );
      bucketsRef.current.set(previousKey, previous);
    }
    streamRef.current?.stream.close();
    streamRef.current = null;
    runningIdRef.current = null;
    reconnectingRef.current = false;
    keyRef.current = commitKey;
    setRunning(false);
    if (recoveredTimer.current) clearTimeout(recoveredTimer.current);
    setCards(commitKey ? (bucketsRef.current.get(commitKey) ?? []) : []);
    // Issue 25 / Ticket 03 — replay the persisted stream for this bucket.
    if (commitKey && repo) {
      void hydrateBucket(commitKey, repo.id, repo.commit ?? 'unversioned');
    }
  }, [commitKey, hydrateBucket, repo]);

  useEffect(
    () => () => {
      streamRef.current?.stream.close();
      if (recoveredTimer.current) clearTimeout(recoveredTimer.current);
    },
    []
  );

  const submit = useCallback(
    (intent: string, target?: string) => {
      const current = repoRef.current;
      const text = intent.trim();
      if (!current || !text || runningIdRef.current) return;

      const cardId = newTempCardId();
      const card: EvolutionCard = {
        kind: 'evolve',
        id: cardId,
        intent: text,
        ...(target ? { target } : {}),
        status: 'streaming',
        stages: {},
        echo: null,
        result: null,
        mermaid: null,
        commit: null,
        error: null,
        conflict: null
      };
      const list = bucketsRef.current.get(keyRef.current) ?? [];
      const next = [...list, card];
      bucketsRef.current.set(keyRef.current, next);
      setCards(next);

      runningIdRef.current = cardId;
      setRunning(true);

      const stages: Record<string, 'running' | 'done'> = {};
      const stream = client.evolveStream(current.id, text, target);
      streamRef.current = { kind: 'evolve', stream };
      stream.onEvent((event) => {
        if (event.type === 'stage') {
          stages[event.payload.stage] = event.payload.status;
          patchCard(cardId, {
            stages: { ...stages },
            ...(event.payload.intentEcho ? { echo: event.payload.intentEcho } : {})
          });
        } else if (event.type === 'done') {
          patchCard(cardId, {
            // Issue 25 / Ticket 03 — adopt the server-minted card id so the
            // hydrated replay dedupes against this card instead of doubling.
            ...(event.payload.cardId ? { id: event.payload.cardId } : {}),
            echo: event.payload.intentEcho,
            result: event.payload.result,
            mermaid: event.payload.mermaid ?? null,
            commit: event.payload.commit ?? null,
            status: 'done'
          });
          runningIdRef.current = null;
          setRunning(false);
        } else {
          patchCard(cardId, {
            // Issue 25 / Ticket 03 — adopt the persisted error-card id.
            ...(event.payload.cardId ? { id: event.payload.cardId } : {}),
            error: event.payload.error,
            conflict: event.payload.conventionConflict ?? null,
            status: 'error'
          });
          runningIdRef.current = null;
          setRunning(false);
        }
      });
      stream.onError((err) => {
        patchCard(cardId, {
          error: err instanceof Error ? err.message : String(err),
          status: 'error'
        });
        runningIdRef.current = null;
        setRunning(false);
      });
      stream.onDone(() => {
        // Safety net: the terminal SSE event already finalized the card; this
        // only guards a stream that ends without one.
        if (runningIdRef.current === cardId) {
          patchCard(cardId, { status: 'done' });
          runningIdRef.current = null;
          setRunning(false);
        }
      });
      stream.connect();
    },
    [client, patchCard]
  );

  // v1.4.x（2026-10-19 定位裁决）— `submitIncident` 及其独占状态已删除：
  // Web 侧无任何调用方（死链），服务端 incident 能力保持不变。

  return {
    cards,
    running,
    submit
  };
}
