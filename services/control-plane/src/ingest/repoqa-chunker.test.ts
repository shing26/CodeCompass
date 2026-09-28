/**
 * Ticket 04 + 05 (v1.1) — chunker rules: declaration-level comments/docstrings
 * for Java (byte-parity) plus TS/TSX/JS/Python; markdown structured sections
 * with breadcrumbs. Extraction is a pure function of (path, content), which is
 * what makes the full-index and hot-reload passes byte-identical by design.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { openDb } from '../db';
import { RepoQARepos } from './repoqa-repos';
import { extractCommentBlocks, splitMarkdownSections } from './repoqa-chunker';
import { maskSensitiveText } from '../engine/repoqa-masking';

describe('extractCommentBlocks — TS/TSX/JS (ticket 04)', () => {
  it('collects JSDoc blocks and a plain /* */ file header, in source order', () => {
    const content = [
      '/*',
      ' * MIT header',
      ' */',
      'import x from "y";',
      '',
      '/**',
      ' * Renders the like button.',
      ' */',
      'export function LikeButton() {}',
      ''
    ].join('\n');
    const blocks = extractCommentBlocks('src/LikeButton.tsx', content);
    expect(blocks.map((b) => b.lineStart)).toEqual([1, 6]);
    expect(blocks[0].content).toContain('MIT header');
    expect(blocks[1].content).toContain('like button');
  });

  it('collects a leading // run as one header block, shebang allowed above it', () => {
    const plain = ['// header line', '// second', 'const x = 1;'].join('\n');
    expect(extractCommentBlocks('src/a.ts', plain).map((b) => [b.lineStart, b.content])).toEqual([
      [1, '// header line\n// second']
    ]);

    const shabanged = ['#!/usr/bin/env node', '// boot stub', 'main();'].join('\n');
    expect(extractCommentBlocks('src/bin.mjs-ish.ts', shabanged).map((b) => b.lineStart)).toEqual([2]);
  });

  it('returns nothing for .jsx (not in scope) or comment-free files', () => {
    expect(extractCommentBlocks('src/a.jsx', '/** doc */\n')).toEqual([]);
    expect(extractCommentBlocks('src/plain.ts', 'const x = 1;\n')).toEqual([]);
  });
});

describe('extractCommentBlocks — Python (ticket 04)', () => {
  it('collects module, class and def docstrings', () => {
    const content = [
      '"""Social demo module."""',
      '',
      'class Post:',
      '    """A post entity."""',
      '',
      '    def like(self):',
      '        """Mark the post as liked."""',
      '        return True',
      ''
    ].join('\n');
    expect(extractCommentBlocks('svc/post.py', content).map((b) => b.lineStart)).toEqual([1, 4, 7]);
  });

  it('handles a multi-line def signature before the docstring', () => {
    const content = ['def g(', '    a,', '):', '    """Doc."""', '    pass'].join('\n');
    expect(extractCommentBlocks('svc/g.py', content).map((b) => b.lineStart)).toEqual([4]);
  });

  it('ignores triple-quoted strings that are not docstrings', () => {
    const content = [
      'def f():',
      '    x = 1',
      '    s = """',
      '    not a docstring, just a value',
      '    """',
      '    return x'
    ].join('\n');
    expect(extractCommentBlocks('svc/f.py', content)).toEqual([]);
  });
});

describe('extractCommentBlocks — Java parity (ticket 04)', () => {
  it('keeps the pre-v1.1 Javadoc-only behavior (plain /* */ ignored)', () => {
    const content = ['/* plain */', '/** Javadoc */', 'class A {}'].join('\n');
    const blocks = extractCommentBlocks('src/A.java', content);
    expect(blocks.map((b) => b.content)).toEqual(['/** Javadoc */']);
    expect(blocks[0].lineStart).toBe(2);
  });
});

describe('splitMarkdownSections (ticket 05)', () => {
  it('splits at headings and prefixes the h1 > h2 breadcrumb', () => {
    const md = ['# Guide', 'intro text', '## Usage', 'run it', '### Tips', 'be nice'].join('\n');
    const sections = splitMarkdownSections(md);
    expect(sections.map((s) => s.content)).toEqual([
      '[Guide]\n# Guide\nintro text',
      '[Guide > Usage]\n## Usage\nrun it',
      '[Guide > Usage]\n### Tips\nbe nice'
    ]);
    expect(sections.map((s) => s.lineStart)).toEqual([1, 3, 5]);
  });

  it('ignores # lines inside fenced code blocks', () => {
    const md = ['# T', '```bash', '# not a heading', '```', 'tail'].join('\n');
    const sections = splitMarkdownSections(md);
    expect(sections.length).toBe(1);
    expect(sections[0].content).toContain('# not a heading');
  });

  it('splits oversized sections at line boundaries (no silent truncation)', () => {
    const md = '# Big\n\n' + 'filler line that pads the section nicely\n'.repeat(300);
    const pieces = splitMarkdownSections(md);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[0].content.startsWith('[Big]')).toBe(true);
    expect(pieces[1].lineStart).toBeGreaterThan(1);
  });

  it('a document with no headings still splits when longer than the cap', () => {
    const md = Array.from({ length: 300 }, (_, i) => `line ${i} of a long document`).join('\n');
    const pieces = splitMarkdownSections(md);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.content.length <= 4001)).toBe(true);
  });
});

describe('ticket 04/05 wiring', () => {
  it('masks fake credentials in a TS comment before anything would be inserted', () => {
    const secret = 'AKIA' + 'A'.repeat(16); // runtime concat, HANDOFF §2.3-2
    const content = ['/**', ` * access key ${secret} for tests`, ' */', 'export const k = 1;'].join('\n');
    const [block] = extractCommentBlocks('src/k.ts', content);
    const masked = maskSensitiveText(block.content);
    expect(masked).not.toContain(secret);
    expect(masked).toContain('[REDACTED AWS KEY]');
  });

  it('latter-half markdown is retrievable through the FTS mirror (tickets 03+04+05)', () => {
    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    repoqa.createRepo({ id: 'r1', name: 'md-store', localPath: 'D:/repo' });

    const md = '# Doc\n\n' + 'filler padding line\n'.repeat(400) + '\n## Tail\n\nthe zuniqueterm lives here\n';
    const chunks = splitMarkdownSections(maskSensitiveText(md)).map((section) => ({
      repoId: 'r1',
      chunkType: 'readme' as const,
      content: section.content,
      filePath: 'docs/Big.md',
      lineStart: section.lineStart
    }));
    repoqa.upsertChunks(chunks);

    // Pre-ticket-05 this word sat past the 4000-char slice and was unreachable;
    // the hit also proves the FTS mirror indexed the newly covered chunks.
    const hits = repoqa.searchChunks('r1', 'zuniqueterm lives');
    expect(hits.length).toBe(1);
    expect(hits[0].lineStart).toBeGreaterThan(1);
    db.close();
  });

  it('deterministic: the same file extracted twice yields identical blocks', () => {
    const content = ['// head', '/** api */', 'export const a = 1;'].join('\n');
    expect(extractCommentBlocks('src/a.ts', content)).toEqual(extractCommentBlocks('src/a.ts', content));
  });

  it('Go stays out of scope (ticket 07 owns the boundary wording)', () => {
    const source = readFileSync(new URL('./repoqa-chunker.ts', import.meta.url), 'utf8');
    expect(source).not.toContain("endsWith('.go')");
    expect(source).not.toContain('endsWith(".go")');
  });
});
