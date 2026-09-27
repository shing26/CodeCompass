/**
 * Issue 01 (v1.1) — `searchChunks` treats user input literally: `_`, `%` and
 * `\` must match as characters, not as LIKE metacharacters.
 */
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { RepoQARepos, escapeLikePattern } from './repoqa-repos';
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
