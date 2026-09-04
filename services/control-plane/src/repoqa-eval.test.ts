import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { RepoQARepos } from './repoqa-repos';
import {
  commitFixture,
  EVAL_PASS_THRESHOLDS,
  GOLDEN_DATASET,
  GOLDEN_FIXTURES,
  materializeFixture,
  recordEvalReport,
  runGoldenEval,
  type EvalReport
} from './repoqa-eval';

const BUCKET_TOTALS: Record<
  | 'route-chain'
  | 'config'
  | 'architecture'
  | 'intent-anchor'
  | 'diagnose-chain'
  | 'evolution'
  | 'incident'
  | 'evolve-intent'
  | 'convention',
  number
> = {
  'route-chain': 20,
  config: 15,
  architecture: 15,
  'intent-anchor': 5,
  'diagnose-chain': 5,
  evolution: 5,
  incident: 10,
  // Issue 24 / Ticket 06 — append-only workbench buckets on top of the frozen 75.
  'evolve-intent': 14,
  convention: 8
};

describe('RepoPulse golden eval dataset (Issue 09)', () => {
  it('freezes 97 golden questions: 75 frozen + 22 append-only workbench cases across nine buckets', () => {
    expect(GOLDEN_DATASET).toHaveLength(97);
    const byMode: Record<string, number> = {
      'route-chain': 0,
      config: 0,
      architecture: 0,
      'intent-anchor': 0,
      'diagnose-chain': 0,
      evolution: 0,
      incident: 0,
      'evolve-intent': 0,
      convention: 0
    };
    const ids = new Set<string>();
    for (const question of GOLDEN_DATASET) {
      byMode[question.mode] += 1;
      expect(ids.has(question.id)).toBe(false);
      ids.add(question.id);
      expect(GOLDEN_FIXTURES.some((fixture) => fixture.name === question.fixture)).toBe(true);
      expect(question.question.trim().length).toBeGreaterThan(0);
      // Reverse cases assert via expectedAbsent (orphan false-positives),
      // expectedBreak (diagnose BROKEN expectations), expectedUnresolved
      // (incident BREAK negatives) — or, for the symptom-only incident case,
      // via the engine producing nothing at all.
      expect(
        question.expected.length > 0 ||
          (question.expectedAbsent?.length ?? 0) > 0 ||
          question.expectedBreak !== undefined ||
          (question.expectedUnresolved?.length ?? 0) > 0 ||
          (question.mode === 'incident' && question.stack === undefined)
      ).toBe(true);
    }
    expect(byMode).toEqual(BUCKET_TOTALS);
    expect(ids.size).toBe(97);
  });

  it('materializes and commits fixtures deterministically', async () => {
    const repoA = GOLDEN_FIXTURES.find((fixture) => fixture.name === 'repo-a')!;
    const repoB = GOLDEN_FIXTURES.find((fixture) => fixture.name === 'repo-b')!;
    const one = await materializeFixture(repoA);
    const two = await materializeFixture(repoA);
    const other = await materializeFixture(repoB);
    try {
      const hashOne = await commitFixture(one);
      const hashTwo = await commitFixture(two);
      const hashOther = await commitFixture(other);
      expect(hashOne).toMatch(/^[0-9a-f]{40}$/i);
      expect(hashOne).toBe(hashTwo);
      expect(hashOne).not.toBe(hashOther);
    } finally {
      await Promise.all([
        fs.rm(one, { recursive: true, force: true }),
        fs.rm(two, { recursive: true, force: true }),
        fs.rm(other, { recursive: true, force: true })
      ]);
    }
  }, 20_000);

  // Issue 23: five fixtures × git init/commit + full index now exceed the
  // 5s default; the replay stays deterministic, just not instant.
  it('runs the full golden eval, passes every threshold, and records eval events', { timeout: 60_000 }, async () => {
    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    try {
      const report = await runGoldenEval(repoqa);

      // Report is frozen and green.
      expect(report.totalQuestions).toBe(97);
      expect(report.passed).toBe(true);
      for (const name of ['repo-a', 'repo-b', 'repo-c', 'repo-d', 'repo-e']) {
        expect(report.fixtureCommits[name]).toMatch(/^[0-9a-f]{40}$/i);
      }
      expect(report.buckets['route-chain'].total).toBe(20);
      expect(report.buckets.config.total).toBe(15);
      expect(report.buckets.architecture.total).toBe(15);
      expect(report.buckets['intent-anchor'].total).toBe(5);
      expect(report.buckets['diagnose-chain'].total).toBe(5);
      expect(report.buckets.evolution.total).toBe(5);
      expect(report.buckets.incident.total).toBe(10);
      expect(report.buckets['evolve-intent'].total).toBe(14);
      expect(report.buckets.convention.total).toBe(8);
      // Issue 23: the incident bucket enforces the Zero-Hallucination
      // Contract — 0% hallucination, not the ≤2% budget of the other buckets.
      expect(report.buckets.incident.hallucinationRate).toBe(0);
      // Ticket 06: the workbench buckets carry the same Zero-Hallucination
      // Contract — a forbidden anchor or a fabricated axis is a failure.
      expect(report.buckets['evolve-intent'].hallucinationRate).toBe(0);
      expect(report.buckets.convention.hallucinationRate).toBe(0);
      expect(report.failureTaxonomy).toEqual({ parse: 0, retrieval: 0, generation: 0, anchor: 0 });
      for (const bucket of Object.values(report.buckets)) {
        expect(bucket.recallAtK).toBeGreaterThanOrEqual(EVAL_PASS_THRESHOLDS.recallAtK);
        expect(bucket.hallucinationRate).toBeLessThanOrEqual(EVAL_PASS_THRESHOLDS.hallucinationRateMax);
        expect(bucket.anchorValidity).toBeGreaterThanOrEqual(EVAL_PASS_THRESHOLDS.anchorValidity);
      }

      // Evidence plane carries one eval.run summary + one eval.bucket per bucket.
      const { events } = repoqa.listEvents();
      const runEvents = events.filter((event) => event.eventType === 'eval.run');
      expect(runEvents).toHaveLength(1);
      expect(runEvents[0].repoId).toBeUndefined();
      expect(runEvents[0].intent).toBe('golden-eval');
      expect(runEvents[0].failureClass).toBeUndefined();
      const summary = JSON.parse(runEvents[0].feedback ?? '{}') as {
        passed: boolean;
        totalQuestions: number;
        buckets: EvalReport['buckets'];
        failureTaxonomy: EvalReport['failureTaxonomy'];
      };
      expect(summary.passed).toBe(true);
      expect(summary.totalQuestions).toBe(97);
      expect(summary.failureTaxonomy).toEqual({ parse: 0, retrieval: 0, generation: 0, anchor: 0 });

      const bucketEvents = events.filter((event) => event.eventType === 'eval.bucket');
      expect(bucketEvents).toHaveLength(9);
      const byIntent = new Map(
        bucketEvents.map((event) => [event.intent, event] as const)
      );
      for (const [mode, total] of Object.entries(BUCKET_TOTALS) as Array<
        ['route-chain' | 'config' | 'architecture', number]
      >) {
        const event = byIntent.get(mode);
        expect(event).toBeDefined();
        expect(event?.failureClass).toBeUndefined();
        const metrics = JSON.parse(event?.feedback ?? '{}') as Record<string, number>;
        expect(metrics.total).toBe(total);
        expect(metrics.recallAtK).toBeGreaterThanOrEqual(EVAL_PASS_THRESHOLDS.recallAtK);
        expect(metrics.anchorValidity).toBeGreaterThanOrEqual(EVAL_PASS_THRESHOLDS.anchorValidity);
      }
    } finally {
      db.close();
    }
  });

  it('recordEvalReport maps a failing run onto eval failure classes', () => {
    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    const failing: EvalReport = {
      passed: false,
      totalQuestions: 75,
      fixtureCommits: { 'repo-a': 'a'.repeat(40), 'repo-b': 'b'.repeat(40), 'repo-c': 'c'.repeat(40) },
      buckets: {
        'route-chain': { total: 20, recallAtK: 50, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        config: { total: 15, recallAtK: 100, hallucinationRate: 20, anchorValidity: 100, avgLatencyMs: 1 },
        architecture: { total: 15, recallAtK: 100, hallucinationRate: 0, anchorValidity: 50, avgLatencyMs: 1 },
        'intent-anchor': { total: 5, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        'diagnose-chain': { total: 5, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        evolution: { total: 5, recallAtK: 50, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        incident: { total: 10, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        'evolve-intent': { total: 14, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        convention: { total: 8, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 }
      },
      failureTaxonomy: { parse: 1, retrieval: 1, generation: 1, anchor: 1 }
    };
    recordEvalReport(repoqa, failing);
    const { events } = repoqa.listEvents();
    const run = events.find((event) => event.eventType === 'eval.run');
    expect(run?.failureClass).toBe('eval-failed');
    const committed = events.filter((event) => event.eventType === 'eval.bucket');
    expect(committed).toHaveLength(9);
    expect(committed.filter((event) => event.failureClass === 'threshold-miss')).toHaveLength(4);
    db.close();
  });

  it('writes eval events without a repoId but still listable by event type', () => {
    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    const green: EvalReport = {
      passed: true,
      totalQuestions: 50,
      fixtureCommits: { 'repo-a': 'a'.repeat(40), 'repo-b': 'b'.repeat(40), 'repo-c': 'c'.repeat(40) },
      buckets: {
        'route-chain': { total: 20, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        config: { total: 15, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        architecture: { total: 15, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        'intent-anchor': { total: 5, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        'diagnose-chain': { total: 5, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        evolution: { total: 5, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        incident: { total: 10, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        'evolve-intent': { total: 14, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 },
        convention: { total: 8, recallAtK: 100, hallucinationRate: 0, anchorValidity: 100, avgLatencyMs: 1 }
      },
      failureTaxonomy: { parse: 0, retrieval: 0, generation: 0, anchor: 0 }
    };
    recordEvalReport(repoqa, green);
    const byType = repoqa.listEvents({ eventType: 'eval.run' });
    expect(byType.total).toBe(1);
    expect(byType.events[0].repoId).toBeUndefined();
    const anyRepoFilter = repoqa.listEvents({ repoId: '__eval__' });
    expect(anyRepoFilter.total).toBe(0);
    db.close();
  });
});