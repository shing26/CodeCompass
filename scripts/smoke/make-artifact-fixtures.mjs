/**
 * v1.7 票 01 — 工件浏览器验收（Artifact Browser Gate）的 fixture 生成器。
 *
 * 只生成、不提交产物：good 工件由真实 codecompass export 产出；三份 bad 在
 * 字符串层注入已知事故（残缺 mermaid / 删 lazy-view 脚本 / 删 Story Beats 脚本），
 * 用来证明现有门（单测 + e2e 的字符串断言）抓不到浏览器层故障。
 *
 * 用法：
 *   node scripts/smoke/make-artifact-fixtures.mjs [--out <dir>] [--json]
 * 输出最后一行 JSON：{ good, badSyntax, badLazy, badBeats, repoDir, dataDir }
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'services', 'control-plane', 'dist', 'cli.js');

const JAVA_CONTROLLER = [
  'package com.demo;',
  'import org.springframework.web.bind.annotation.*;',
  '@RestController',
  '@RequestMapping("/api/owners")',
  'public class OwnerController {',
  '  private final OwnerService ownerService = new OwnerService();',
  '  @GetMapping',
  '  public String listOwners() { return ownerService.findOwners(); }',
  '}'
].join('\n');

const JAVA_SERVICE = [
  'package com.demo;',
  'import org.springframework.stereotype.Service;',
  '@Service',
  'public class OwnerService {',
  '  private final OwnerRepository ownerRepository = new OwnerRepository();',
  '  public String findOwners() { return ownerRepository.findAll(); }',
  '}'
].join('\n');

const JAVA_REPOSITORY = [
  'package com.demo;',
  'import org.apache.ibatis.annotations.Mapper;',
  'import org.apache.ibatis.annotations.Select;',
  '@Mapper',
  'public interface OwnerRepository {',
  '  @Select("SELECT * FROM owners")',
  '  String findAll();',
  '}'
].join('\n');

const TS_CLIENT = [
  "import axios from 'axios';",
  "export const api = axios.create({ baseURL: '/api' });",
  "export function loadOwners() { return api.get('/owners'); }"
].join('\n');

function fail(message) {
  console.error('fixtures: ' + message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { outDir: path.join(os.tmpdir(), 'codecompass-artifact-fixtures'), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') out.outDir = path.resolve(argv[++i]);
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

function writeDemoRepo(repoDir) {
  const files = {
    'src/main/java/com/demo/OwnerController.java': JAVA_CONTROLLER,
    'src/main/java/com/demo/OwnerService.java': JAVA_SERVICE,
    'src/main/java/com/demo/OwnerRepository.java': JAVA_REPOSITORY,
    'web/src/api-client.ts': TS_CLIENT,
    'web/package.json': JSON.stringify(
      { name: 'demo-web', dependencies: { axios: '^1.6.0', react: '^18.2.0' } },
      null,
      2
    )
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repoDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

/** 用真实 CLI 产出一份 good 工件（与 release.yml:45-85 同一条路径）。 */
function makeGoodArtifact(repoDir, dataDir, goodPath) {
  const res = spawnSync(
    process.execPath,
    [CLI, 'export', 'listOwners', repoDir, '--file', goodPath, '--data-dir', dataDir],
    { cwd: ROOT, encoding: 'utf8' }
  );
  if (res.status !== 0) {
    fail('codecompass export failed (' + res.status + ')\n' + (res.stdout || '') + (res.stderr || ''));
  }
  if (!fs.existsSync(goodPath)) fail('export reported success but wrote no artifact: ' + goodPath);
  const html = fs.readFileSync(goodPath, 'utf8');
  const missing = [];
  if (!html.includes('class="mermaid"')) missing.push('class="mermaid"');
  if (!html.includes('data-view="sequence"')) missing.push('data-view="sequence"');
  if (!html.includes('id="beat-next"')) missing.push('id="beat-next"');
  if (missing.length > 0) {
    fail('good artifact lacks expected check targets: ' + missing.join(', '));
  }
  return html;
}

/** 三份 bad 各自只破坏一个已知事故点，其余字节与 good 相同。 */
function makeBadArtifacts(html, outDir) {
  const cases = [];

  const syntaxBroken = html.replace(
    /(<pre class="mermaid"[^>]*>)([\s\S]*?)(<\/pre>)/,
    '$1flowchart LR\n  A -->$3'
  );
  if (syntaxBroken === html) fail('could not locate <pre class="mermaid"> for bad-syntax');
  cases.push(['bad-syntax.html', syntaxBroken]);

  const lazyBroken = html.replace(
    /<script>\s*\(function \(\) \{\s*\/\/ Lazy mermaid render[\s\S]*?<\/script>/,
    ''
  );
  if (lazyBroken === html) fail('could not remove VIEWS_JS for bad-lazy');
  cases.push(['bad-lazy.html', lazyBroken]);

  const beatsBroken = html.replace(
    /<script>\s*\(function \(\) \{\s*var beats = JSON\.parse[\s\S]*?<\/script>/,
    ''
  );
  if (beatsBroken === html) fail('could not remove STORY_BEATS_JS for bad-beats');
  cases.push(['bad-beats.html', beatsBroken]);

  const written = {};
  for (const [name, content] of cases) {
    const abs = path.join(outDir, name);
    fs.writeFileSync(abs, content, 'utf8');
    written[name] = abs;
  }
  return written;
}

export function makeFixtures(outDir = path.join(os.tmpdir(), 'codecompass-artifact-fixtures')) {
  if (!fs.existsSync(CLI)) {
    fail('missing build: ' + CLI + ' (run: npm run build --prefix services/control-plane)');
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  const repoDir = path.join(outDir, 'demo-polyglot');
  const dataDir = path.join(outDir, 'data');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  writeDemoRepo(repoDir);

  const goodPath = path.join(outDir, 'good.html');
  const html = makeGoodArtifact(repoDir, dataDir, goodPath);
  const bad = makeBadArtifacts(html, outDir);
  return { good: goodPath, ...bad, repoDir, dataDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = makeFixtures(args.outDir);
  if (args.json) console.log(JSON.stringify(result));
  else {
    console.log('fixtures dir : ' + args.outDir);
    for (const [key, value] of Object.entries(result)) console.log('  ' + key + ': ' + value);
  }
}
