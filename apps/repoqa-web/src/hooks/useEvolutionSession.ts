import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvolveStreamLike, RepoQAClient } from '../client/RepoQAClient';
import type {
  ConventionConflictDetail,
  EvolutionIntentEcho,
  ModuleEvolutionResult,
  Repo
} from '../types';

let nextCardId = 1;

/**
 * Issue 24 / Ticket 24.5 — one artifact card in the investigation stream:
 * a delivered intent plus everything the evolve run produced for it.
 */
export interface EvolutionCard {
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

export interface UseEvolutionSessionResult {
  /** Artifact cards of the CURRENT (repoId, commit) stream, delivery order. */
  cards: EvolutionCard[];
  /** True while the latest delivery is still streaming. */
  running: boolean;
  /** Deliver a new intent into the current stream (追问 = another delivery). */
  submit: (intent: string, target?: string) => void;
}

/**
 * Ticket 24.5 — Artifact Stream session state (ADR-0012): append-only
 * artifact-card timeline bucketed by (repoId, commit). Switching repos or a
 * changed commit (e.g. after re-index; dirty is already encoded by the
 * backend as `hash+dirty`) opens/switches the stream — cards never mix.
 * v1 keeps buckets in memory only; server-side persistence is Issue 25.
 *
 * Lives at the App level (like useChat) so the stream survives tab switches.
 */
export function useEvolutionSession(
  client: Pick<RepoQAClient, 'evolveStream'>,
  repo: Repo | null
): UseEvolutionSessionResult {
  const [cards, setCards] = useState<EvolutionCard[]>([]);
  const [running, setRunning] = useState(false);
  const bucketsRef = useRef(new Map<string, EvolutionCard[]>());
  const keyRef = useRef('');
  const repoRef = useRef(repo);
  const streamRef = useRef<EvolveStreamLike | null>(null);
  const runningIdRef = useRef<string | null>(null);

  useEffect(() => {
    repoRef.current = repo;
  }, [repo]);

  /** Patch one card in the current bucket (ref + mirrored state). */
  const patchCard = useCallback((cardId: string, patch: Partial<EvolutionCard>) => {
    const list = bucketsRef.current.get(keyRef.current) ?? [];
    const next = list.map((card) => (card.id === cardId ? { ...card, ...patch } : card));
    bucketsRef.current.set(keyRef.current, next);
    setCards(next);
  }, []);

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
          ? { ...card, status: 'error' as const, error: '会话已切换，推演中断。' }
          : card
      );
      bucketsRef.current.set(previousKey, previous);
    }
    streamRef.current?.close();
    streamRef.current = null;
    runningIdRef.current = null;
    keyRef.current = commitKey;
    setRunning(false);
    setCards(commitKey ? (bucketsRef.current.get(commitKey) ?? []) : []);
  }, [commitKey]);

  useEffect(() => () => streamRef.current?.close(), []);

  const submit = useCallback(
    (intent: string, target?: string) => {
      const current = repoRef.current;
      const text = intent.trim();
      if (!current || !text || runningIdRef.current) return;

      const cardId = `evolve-card-${nextCardId++}`;
      const card: EvolutionCard = {
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
      streamRef.current = stream;
      stream.onEvent((event) => {
        if (event.type === 'stage') {
          stages[event.payload.stage] = event.payload.status;
          patchCard(cardId, {
            stages: { ...stages },
            ...(event.payload.intentEcho ? { echo: event.payload.intentEcho } : {})
          });
        } else if (event.type === 'done') {
          patchCard(cardId, {
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

  return { cards, running, submit };
}
