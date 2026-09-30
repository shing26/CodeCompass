/**
 * Issue 01 (v1.1) — `searchChunks` treats user input literally: `_`, `%` and
 * `\` must match as characters, not as LIKE metacharacters.
 * Ticket 03 (v1.1) — ≥3-char queries route to the FTS5(trigram) mirror with
 * LIKE-equal phrase semantics; both paths share one pinned sort key; the FTS
 * sync lives only in insertChunkRows/deleteChunkRows and is provably in step.
 */
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { openDb } from '../db';
import {
  RepoQARepos,
  SEARCH_CHUNKS_FTS_SQL,
  SEARCH_CHUNKS_LIKE_SQL,
  escapeLikePattern,
  ftsPhrase
} from './repoqa-repos';
import type { RepoChunk } from './repoqa-repos';

function makeStore(): { db: ReturnType<typeof openDb>; repoqa: RepoQARepos } {
  const db = openDb(':memory:');
  const repoqa = new RepoQARepos(db);
  repoqa.createRepo({ id: 'r1', name: 'chunk-store', localPath: 'D:/repo' });
  return { db, repoqa };
}

function chunk(content: string): RepoChunk {
  return { repoId: 'r1', chunkType: 'comment', content, filePath: 'src/App.java', lineStart: 1 };
}

describe('escapeLikePattern', () => {
  it('escapes backslash first, then % and _', () => {
    expect(escapeLikePattern('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });
});

describe('searchChunks LIKE escaping', () => {
  it('treats `_` in the query as a literal, not a single-char wildcard', () => {
    const { db, repoqa } = makeStore();
    // The decoded `_`s each swallow one arbitrary character, so the wildcard
    // pattern also hits this camelCase neighbour.
    repoqa.upsertChunks([chunk('int get_user_id() {'), chunk('int getXuserXid() {')]);

    const hits = repoqa.searchChunks('r1', 'get_user_id');

    expect(hits.map((c) => c.content)).toEqual(['int get_user_id() {']);
    db.close();
  });

  it('treats `%` in the query as a literal, not a match-all wildcard', () => {
    const { db, repoqa } = makeStore();
    repoqa.upsertChunks([chunk('coverage 100% reached'), chunk('no percent sign here')]);

    const hits = repoqa.searchChunks('r1', '%');

    expect(hits.map((c) => c.content)).toEqual(['coverage 100% reached']);
    db.close();
  });

  it('keeps backslashes literal so `\\` and `%` in one query both match literally', () => {
    const { db, repoqa } = makeStore();
    repoqa.upsertChunks([chunk('path C:\\tmp\\%done.txt'), chunk('path C:\\tmp\\XXdone.txt')]);

    const hits = repoqa.searchChunks('r1', 'C:\\tmp\\%done');

    expect(hits.map((c) => c.content)).toEqual(['path C:\\tmp\\%done.txt']);
    db.close();
  });
});

describe('ftsPhrase', () => {
  it('wraps the query in quotes and doubles embedded quotes', () => {
    expect(ftsPhrase('a"b')).toBe('"a""b"');
  });
});

describe('searchChunks FTS trigram path (票 03)', () => {
  it('hits ≥3-char queries via the trigram mirror and <3-char ones via LIKE', () => {
    const { db, repoqa } = makeStore();
    repoqa.upsertChunks([chunk('用户点赞功能在 PostService 中'), chunk('完全无关的内容')]);

    // 2 chars: a trigram index cannot match tokens shorter than 3 chars, so a
    // hit here can only come from the LIKE path.
    expect(repoqa.searchChunks('r1', '点赞').map((c) => c.content)).toEqual([
      '用户点赞功能在 PostService 中'
    ]);
    // 4 chars: routed to FTS.
    expect(repoqa.searchChunks('r1', '点赞功能').map((c) => c.content)).toEqual([
      '用户点赞功能在 PostService 中'
    ]);
    db.close();
  });

  it('keeps contiguous-substring semantics: non-adjacent trigrams never match', () => {
    const { db, repoqa } = makeStore();
    repoqa.upsertChunks([chunk('alpha beta gamma delta')]);

    // An AND-of-trigrams MATCH would hit "alpha beta gamma delta" for
    // "alpha delta"; the phrase query must not — that is the LIKE-parity line.
    expect(repoqa.searchChunks('r1', 'alpha delta')).toEqual([]);
    expect(repoqa.searchChunks('r1', 'gamma delta').map((c) => c.content)).toEqual([
      'alpha beta gamma delta'
    ]);
    db.close();
  });

  it('returns one defined order for one dataset, identical on both paths', () => {
    const { db, repoqa } = makeStore();
    const rows: RepoChunk[] = [
      { repoId: 'r1', chunkType: 'comment', content: 'gamma one', filePath: 'src/b.java', lineStart: 2 },
      { repoId: 'r1', chunkType: 'comment', content: 'gamma two', filePath: 'src/a.java', lineStart: 9 },
      { repoId: 'r1', chunkType: 'comment', content: 'gamma three', filePath: 'src/a.java', lineStart: 1 },
      { repoId: 'r1', chunkType: 'comment', content: 'gamma four', filePath: 'src/a.java', lineStart: 1 }
    ];
    repoqa.upsertChunks(rows);
    // Insertion order is one/two/three/four → ids 1..4; the pinned key orders
    // a.java:1(id3) < a.java:1(id4) < a.java:9(id2) < b.java:2(id1).
    const expected = ['gamma three', 'gamma four', 'gamma two', 'gamma one'];
    const viaFts = repoqa.searchChunks('r1', 'gamma').map((c) => c.content);
    const viaLike = repoqa.searchChunks('r1', 'ga').map((c) => c.content);
    expect(viaFts).toEqual(expected);
    expect(viaFts).toEqual(viaLike);
    db.close();
  });

  it('keeps % _ and double quotes literal inside the FTS phrase', () => {
    const { db, repoqa } = makeStore();
    repoqa.upsertChunks([chunk('env a_b%c"d set'), chunk('plain filler text')]);

    const hits = repoqa.searchChunks('r1', 'a_b%c"d');

    expect(hits.map((c) => c.content)).toEqual(['env a_b%c"d set']);
    db.close();
  });

  it('does not bleed across repos', () => {
    const { db, repoqa } = makeStore();
    repoqa.createRepo({ id: 'r2', name: 'other', localPath: 'D:/other' });
    repoqa.upsertChunks([chunk('alpha beta gamma')]);
    repoqa.upsertChunks([{ ...chunk('alpha beta gamma'), repoId: 'r2' }]);

    expect(repoqa.searchChunks('r1', 'alpha beta').length).toBe(1);
    expect(repoqa.searchChunks('r2', 'alpha beta').length).toBe(1);
    db.close();
  });

  it('EXPLAIN QUERY PLAN: the ≥3-char path reads the mirror, the LIKE path does not (验收② 留档)', () => {
    const { db, repoqa } = makeStore();
    repoqa.upsertChunks([chunk('alpha beta gamma')]);

    const ftsPlan = db
      .prepare(`EXPLAIN QUERY PLAN ${SEARCH_CHUNKS_FTS_SQL}`)
      .all(ftsPhrase('gamma'), 'r1', 20) as Array<{ detail: string }>;
    expect(ftsPlan.some((r) => /repo_chunks_fts/.test(r.detail))).toBe(true);

    const likePlan = db
      .prepare(`EXPLAIN QUERY PLAN ${SEARCH_CHUNKS_LIKE_SQL}`)
      .all('r1', '%gamma%', 20) as Array<{ detail: string }>;
    expect(likePlan.some((r) => /repo_chunks_fts/.test(r.detail))).toBe(false);
    db.close();
  });

  it('reindex leaves no ghost trigrams: replaced content is found, old content is gone', () => {
    const { db, repoqa } = makeStore();
    repoqa.upsertChunks([chunk('legacy onboarding readme text')]);
    repoqa.upsertChunks([chunk('brand new onboarding text')]);

    expect(repoqa.searchChunks('r1', 'brand new onboarding').map((c) => c.content)).toEqual([
      'brand new onboarding text'
    ]);
    expect(repoqa.searchChunks('r1', 'legacy onboarding readme')).toEqual([]);
    db.close();
  });

  it('hot reload (replaceFileChunks) prunes only that file and keeps the mirror in step', () => {
    const { db, repoqa } = makeStore();
    repoqa.upsertChunks([
      { ...chunk('old widget render code'), filePath: 'src/A.tsx', lineStart: 1 },
      { ...chunk('untouched helper code'), filePath: 'src/B.tsx', lineStart: 1 }
    ]);
    repoqa.replaceFileChunks('r1', 'src/A.tsx', [
      { ...chunk('new widget render code'), filePath: 'src/A.tsx', lineStart: 1 }
    ]);

    expect(repoqa.searchChunks('r1', 'new widget render').map((c) => c.content)).toEqual([
      'new widget render code'
    ]);
    expect(repoqa.searchChunks('r1', 'old widget render')).toEqual([]);
    expect(repoqa.searchChunks('r1', 'untouched helper').map((c) => c.content)).toEqual([
      'untouched helper code'
    ]);
    db.close();
  });

  it('clearRepoData / deleteRepo purge the mirror too (no count drift)', () => {
    const { db, repoqa } = makeStore();
    const ftsCount = (store: { db: ReturnType<typeof openDb> }): number =>
      (store.db.prepare('SELECT COUNT(*) AS n FROM repo_chunks_fts').get() as { n: number }).n;

    repoqa.upsertChunks([chunk('alpha beta gamma')]);
    repoqa.clearRepoData('r1');
    expect(ftsCount({ db })).toBe(0);

    repoqa.upsertChunks([chunk('alpha beta gamma')]);
    repoqa.deleteRepo('r1');
    expect(ftsCount({ db })).toBe(0);
    db.close();
  });

  it('会红: a rogue INSERT that skips the sync helpers is invisible to ≥3-char search until rebuilt', () => {
    const { db, repoqa } = makeStore();
    // Simulate a future writer bypassing insertChunkRows — the exact drift the
    // single-writer rule exists to prevent. The symptom is deterministic and
    // this test codifies it: the row exists in repo_chunks yet ≥3-char search
    // (the production path) cannot see it.
    db
      .prepare(
        'INSERT INTO repo_chunks (repo_id, chunk_type, content, file_path, line_start) VALUES (?, ?, ?, ?, ?)'
      )
      .run('r1', 'comment', 'sneaky rogue chunk', 'src/X.ts', 1);
    expect(repoqa.searchChunks('r1', 'sneaky rogue chunk')).toEqual([]);

    // 复原: the same rebuild openDb runs on count mismatch restores visibility.
    db.exec(
      'DELETE FROM repo_chunks_fts; INSERT INTO repo_chunks_fts(rowid, content) SELECT id, content FROM repo_chunks;'
    );
    expect(repoqa.searchChunks('r1', 'sneaky rogue chunk').map((c) => c.content)).toEqual([
      'sneaky rogue chunk'
    ]);
    db.close();
  });
});

describe('repo_chunks_fts rebuild on open (票 03 验收⑤ 老库升级)', () => {
  it('a v1.0.0 database (chunks written without the mirror) converges on reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fts-upgrade-'));
    const dbPath = join(dir, 'legacy.db');
    try {
      const db = openDb(dbPath);
      new RepoQARepos(db).createRepo({ id: 'r1', name: 'legacy', localPath: 'D:/repo' });
      // Old-writer style: repo_chunks row without any FTS row.
      db
        .prepare(
          'INSERT INTO repo_chunks (repo_id, chunk_type, content, file_path, line_start) VALUES (?, ?, ?, ?, ?)'
        )
        .run('r1', 'comment', 'legacy indexed chunk text', 'src/Old.java', 3);
      db.close();

      const reopened = openDb(dbPath);
      const ftsCount = (reopened.prepare('SELECT COUNT(*) AS n FROM repo_chunks_fts').get() as { n: number }).n;
      const chunkCount = (reopened.prepare('SELECT COUNT(*) AS n FROM repo_chunks').get() as { n: number }).n;
      expect(ftsCount).toBe(chunkCount); // rebuilt; repo_chunks row count unchanged
      expect(
        new RepoQARepos(reopened).searchChunks('r1', 'legacy indexed chunk').map((c) => c.content)
      ).toEqual(['legacy indexed chunk text']);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('upsertByLocalPath 路径归一化（R4-1）', () => {
  it('re-imports the same directory in a different path spelling without creating a second repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'path-norm-'));
    try {
      const store = new RepoQARepos(openDb(':memory:'));
      const p1 = join(dir, 'demo'); // win32 下即反斜杠形态
      mkdirSync(p1, { recursive: true });

      const first = store.upsertByLocalPath({ name: 'demo', localPath: p1 });
      expect(first.created).toBe(true);

      // 同目录的正斜杠 + 尾斜杠写法：必须复用既有行（Round4 实测曾新建第二实体）
      const p2 = `${p1.split(sep).join('/')}/`;
      const second = store.upsertByLocalPath({ name: 'demo-two', localPath: p2 });
      expect(second.repo.id).toBe(first.repo.id);
      expect(second.created).toBe(false);

      // win32 大小写不敏感：大写变体同样复用
      if (process.platform === 'win32') {
        const third = store.upsertByLocalPath({ name: 'demo-three', localPath: p1.toUpperCase() });
        expect(third.repo.id).toBe(first.repo.id);
      }

      // 无论写法几种，目录里只有一个实体（第三轮大写 upsert 会改写存储值，
      // 断言大小写不敏感——NTFS 本就不区分）
      const demoRows = store
        .listRepos()
        .filter((r) => r.localPath.split('\\').join('/').toLowerCase().includes('/demo'));
      expect(demoRows.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
