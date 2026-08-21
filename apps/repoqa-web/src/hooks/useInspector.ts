import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepoQAClient } from '../client/RepoQAClient';

export interface NavEntry {
  file: string;
  line: number;
  lineEnd?: number;
}

export interface InspectorState {
  file: string | null;
  text: string | null;
  loading: boolean;
  error: string | null;
  glow: { line: number; lineEnd?: number } | null;
}

export interface UseInspectorResult extends InspectorState {
  openFile: (file: string, line: number, lineEnd?: number) => void;
  goBack: () => void;
  goForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}

const FILE_CACHE = new Map<string, string>();

/**
 * Drives the Monaco Inspector: loads file contents via file/raw, maintains a
 * back/forward nav stack, and marks the target line with a one-shot glow.
 */
export function useInspector(client: RepoQAClient, repoId: string | null): UseInspectorResult {
  const [state, setState] = useState<InspectorState>({
    file: null,
    text: null,
    loading: false,
    error: null,
    glow: null
  });
  const [stack, setStack] = useState<NavEntry[]>([]);
  const [index, setIndex] = useState(-1);
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((entry: NavEntry, text: string | null) => {
    setState((prev) => ({
      ...prev,
      file: entry.file,
      text,
      loading: false,
      error: null,
      glow: { line: entry.line, lineEnd: entry.lineEnd }
    }));
  }, []);

  const applyGlow = useCallback((entry: NavEntry) => {
    if (glowTimer.current) clearTimeout(glowTimer.current);
    setState((prev) => ({ ...prev, glow: { line: entry.line, lineEnd: entry.lineEnd } }));
    glowTimer.current = setTimeout(() => {
      setState((prev) => ({ ...prev, glow: null }));
    }, 1500);
  }, []);

  const openFile = useCallback(
    (file: string, line: number, lineEnd?: number) => {
      if (!repoId) return;
      const entry: NavEntry = { file, line, lineEnd };
      const cached = FILE_CACHE.get(file);
      if (cached !== undefined) {
        show(entry, cached);
      } else {
        setState((prev) => ({ ...prev, loading: true, error: null, file }));
        client
          .getFileRaw(repoId, file)
          .then((text) => {
            FILE_CACHE.set(file, text);
            show(entry, text);
          })
          .catch((err) => {
            setState((prev) => ({
              ...prev,
              loading: false,
              error: err instanceof Error ? err.message : String(err)
            }));
          });
      }

      setStack((prev) => {
        const next = prev.slice(0, index + 1);
        next.push(entry);
        setIndex(next.length - 1);
        return next;
      });
      applyGlow(entry);
    },
    [applyGlow, client, index, repoId, show]
  );

  const goBack = useCallback(() => {
    setIndex((prev) => {
      const next = Math.max(0, prev - 1);
      const entry = stack[next];
      if (entry) {
        const cached = FILE_CACHE.get(entry.file);
        if (cached !== undefined) {
          show(entry, cached);
        } else if (repoId) {
          client.getFileRaw(repoId, entry.file).then((text) => {
            FILE_CACHE.set(entry.file, text);
            show(entry, text);
          });
        }
        applyGlow(entry);
      }
      return next;
    });
  }, [applyGlow, client, repoId, show, stack]);

  const goForward = useCallback(() => {
    setIndex((prev) => {
      const next = Math.min(stack.length - 1, prev + 1);
      const entry = stack[next];
      if (entry) {
        const cached = FILE_CACHE.get(entry.file);
        if (cached !== undefined) {
          show(entry, cached);
        } else if (repoId) {
          client.getFileRaw(repoId, entry.file).then((text) => {
            FILE_CACHE.set(entry.file, text);
            show(entry, text);
          });
        }
        applyGlow(entry);
      }
      return next;
    });
  }, [applyGlow, client, repoId, show, stack]);

  // Clear when the repo changes.
  useEffect(() => {
    setStack([]);
    setIndex(-1);
    setState({ file: null, text: null, loading: false, error: null, glow: null });
  }, [repoId]);

  useEffect(
    () => () => {
      if (glowTimer.current) clearTimeout(glowTimer.current);
    },
    []
  );

  return {
    ...state,
    openFile,
    goBack,
    goForward,
    canGoBack: index > 0,
    canGoForward: index < stack.length - 1
  };
}