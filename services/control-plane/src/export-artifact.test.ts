import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveBadges,
  locateMermaidScript,
  renderArtifactHtml,
  writeArtifactFile,
  type ArtifactInput
} from './export-artifact';

const baseInput: ArtifactInput = {
  title: 'Diagnose: handleLike',
  repoName: 'petclinic',
  generatedAt: '2026-08-29T00:00:00.000Z',
  mermaid: 'flowchart LR\n  n0["HTTP_ROUTER: likePost"] --> n1["SERVICE: doLike"]',
  sequence: 'sequenceDiagram\n  participant P0 as likePost\n  P0->>P1: call',
  badges: ['Spring', 'MySQL'],
  storyBeats: [
    { label: 'Step 1: HTTP_ROUTER likePost', detail: 'VERIFIED — PostController.java:12', code: '1: likePost()' },
    { label: 'Step 2: SERVICE doLike', detail: 'VERIFIED — PostService.java:20', code: '1: doLike()' }
  ],
  summary: 'Chain of 2 step(s) fully verified.',
  deepLink: 'http://localhost:43110/?repo=r1&focus=handleLike',
  sections: [
    { heading: 'Chain', body: '1. [VERIFIED] HTTP_ROUTER likePost', kind: 'code' },
    { heading: 'Notes', body: 'uses <script>alert(1)</script> & quotes' }
  ]
};

describe('export-artifact (v0.8)', () => {
  it('locates the local mermaid runtime from the monorepo', () => {
    const script = locateMermaidScript();
    expect(script).toBeTruthy();
    expect(script).toContain('mermaid.min.js');
  });

  it('renders a self-contained HTML artifact with inlined mermaid', () => {
    const html = renderArtifactHtml(baseInput);
    expect(html).toContain('<!DOCTYPE html>');
    // Inlined runtime: a full <script> body, not a CDN src (when local file found).
    if (locateMermaidScript()) {
      expect(html).toContain('<script>');
      expect(html).not.toContain('cdn.jsdelivr.net');
    }
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('flowchart LR');
    expect(html).toContain('Chain of 2 step(s) fully verified.');
    expect(html).toContain('http://localhost:43110/?repo=r1&amp;focus=handleLike');
  });

  it('escapes HTML-sensitive characters in bodies and code', () => {
    const html = renderArtifactHtml(baseInput);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp; quotes');
  });

  it('renders view tabs with lazy sequence source and honest placeholders', () => {
    const html = renderArtifactHtml(baseInput);
    expect(html).toContain('data-view="arch"');
    expect(html).toContain('data-view="sequence"');
    // Sequence renders lazily from a raw text source (no zero-width renders).
    expect(html).toContain('id="sequence-src"');
    expect(html).toContain('mermaid.run');
    // Lifecycle/Dataflow are placeholders until their AST evidence ships.
    expect(html).toContain('Lifecycle (v1.0)');
    expect(html).toContain('Dataflow (v1.0)');
    expect(html).toContain('mermaid.initialize({ startOnLoad: true');
  });

  it('renders brand badges and the story beats stepper', () => {
    const html = renderArtifactHtml(baseInput);
    expect(html).toContain('aria-label="Spring"');
    expect(html).toContain('aria-label="MySQL"');
    expect(html).toContain('id="story-beats"');
    expect(html).toContain('id="beat-next"');
    expect(html).toContain('Step 1: HTTP_ROUTER likePost');
    expect(html).toContain('story-beats-data');
  });

  it('derives badges from dependency keyword evidence', () => {
    expect(deriveBadges('org.mybatis:mybatis org.springframework.boot spring-boot-starter-web')).toEqual([
      'Spring',
      'MyBatis'
    ]);
    expect(deriveBadges('no stack here')).toEqual([]);
  });

  it('writes the artifact to disk', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-artifact-'));
    try {
      const html = renderArtifactHtml(baseInput);
      const written = writeArtifactFile(html, path.join(dir, 'artifact.html'));
      const content = await fs.readFile(written, 'utf8');
      expect(content).toContain('Diagnose: handleLike');
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);
});
