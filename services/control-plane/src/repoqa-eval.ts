import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { buildCallIndex, resolveCallChain } from './repoqa-callchain';
import { runDiagnose } from './diagnose-engine';
import { runDomainRadar } from './domain-radar-engine';
import { runModuleEvolution } from './module-evolution-engine';
import { openDb } from './db';
import { EventBus } from './events';
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';

const execFile = promisify(execFileCallback);
const RECALL_K = 5;

// Issue 09: pass thresholds for the golden eval — referenced both when
// computing the report and when mapping bucket results onto the evidence
// plane, so the two can never drift apart.
export const EVAL_PASS_THRESHOLDS = {
  recallAtK: 85,
  hallucinationRateMax: 2,
  anchorValidity: 90
} as const;

function bucketPasses(bucket: EvalReport['buckets'][keyof EvalReport['buckets']]): boolean {
  return (
    bucket.recallAtK >= EVAL_PASS_THRESHOLDS.recallAtK &&
    bucket.hallucinationRate <= EVAL_PASS_THRESHOLDS.hallucinationRateMax &&
    bucket.anchorValidity >= EVAL_PASS_THRESHOLDS.anchorValidity
  );
}

interface EvalFixture {
  name: string;
  files: Record<string, string>;
}

interface EvalQuestion {
  id: string;
  fixture: string;
  mode:
    | 'route-chain'
    | 'config'
    | 'architecture'
    | 'intent-anchor'
    | 'diagnose-chain'
    | 'evolution';
  question: string;
  expected: string[];
  /** diagnose-chain: whether the golden chain SHOULD contain a BROKEN hop. */
  expectedBreak?: boolean;
  /** evolution: names that must NOT appear (e.g. live code never orphaned). */
  expectedAbsent?: string[];
  /** evolution EXTEND: free-text extension goal fed to the pattern matcher. */
  goal?: string;
}

export type EvalBucketName =
  | 'route-chain'
  | 'config'
  | 'architecture'
  | 'intent-anchor'
  | 'diagnose-chain'
  | 'evolution';

export type EvalReport = {
  passed: boolean;
  totalQuestions: number;
  fixtureCommits: Record<string, string>;
  buckets: Record<
    EvalBucketName,
    {
      total: number;
      recallAtK: number;
      hallucinationRate: number;
      anchorValidity: number;
      avgLatencyMs: number;
    }
  >;
  failureTaxonomy: {
    parse: number;
    retrieval: number;
    generation: number;
    anchor: number;
  };
};

const repoA: EvalFixture = {
  name: 'repo-a',
  files: {
    'pom.xml': '<project><groupId>com.demo</groupId><artifactId>demo</artifactId></project>\n',
    'src/main/java/com/demo/App.java':
      'package com.demo;\npublic class App {}\n',
    'src/main/java/com/demo/Controller.java':
      'package com.demo;\n@RestController\npublic class Controller {\n  private final DemoService service = new DemoService();\n  public String hello() {\n    return service.greet();\n  }\n}\n',
    'src/main/java/com/demo/DemoService.java':
      'package com.demo;\n@Service\npublic class DemoService {\n  public String greet() { return "hello"; }\n}\n',
    'src/main/resources/application.yml':
      'spring:\n  datasource:\n    password: hidden\n',
    'src/main/resources/application.properties': 'server.port=8080\n'
  }
};

const repoB: EvalFixture = {
  name: 'repo-b',
  files: {
    'pom.xml': '<project><groupId>com.demo</groupId><artifactId>orders</artifactId></project>\n',
    'src/main/java/com/orders/OrderController.java':
      'package com.orders;\n@RestController\npublic class OrderController {\n  private final OrderService orders = new OrderService();\n  public String createOrder() { return orders.create(); }\n  public String listOrders() { return orders.list(); }\n}\n',
    'src/main/java/com/orders/OrderService.java':
      'package com.orders;\n@Service\npublic class OrderService {\n  public String create() { return "created"; }\n  public String list() { return "listed"; }\n}\n',
    'src/main/resources/application.yml': 'order:\n  datasource:\n    url: jdbc:h2:mem\n'
  }
};

const repoC: EvalFixture = {
  name: 'repo-c',
  files: {
    'src/main/java/com/lib/Calculator.java':
      'package com.lib;\npublic class Calculator {\n  public int add(int a, int b) { return a + b; }\n  public int subtract(int a, int b) { return a - b; }\n}\n',
    'src/main/java/com/lib/StringUtils.java':
      'package com.lib;\npublic class StringUtils {\n  public String slugify(String value) { return value.toLowerCase(); }\n}\n',
    'src/main/resources/application.properties': 'app.name=library\n'
  }
};


/**
 * v0.13 — full-stack "like" fixture exercising the v0.8/v0.9 composite
 * engines: a React caller bridged to a Java route, a MyBatis XML mapper
 * (deterministic DATA_MAPPER hop), Chinese javadoc (doc-chunk intent
 * bridge), a legacy module with transitively orphaned helpers (fixed-point
 * cascade) and three @Transactional declaration levels.
 */
const repoD: EvalFixture = {
  name: 'repo-d',
  files: {
    'pom.xml': '<project><groupId>com.demo</groupId><artifactId>social</artifactId></project>\n',
    'web/src/PostList.tsx': [
      "import axios from 'axios';",
      'const api = axios.create({ baseURL: "/api" });',
      'export function handleLike(id: number) {',
      '  return api.post("/posts/" + id + "/like");',
      '}',
      ''
    ].join('\n'),
    'src/main/java/com/demo/LikeController.java': [
      'package com.demo;',
      'import org.springframework.web.bind.annotation.*;',
      '@RestController',
      '@RequestMapping("/posts")',
      'public class LikeController {',
      '  private final LikeService likeService = new LikeService();',
      '  @PostMapping("/{id}/like")',
      '  public String likePost(@PathVariable Long id) {',
      '    return likeService.doLike(id);',
      '  }',
      '}',
      ''
    ].join('\n'),
    'src/main/java/com/demo/LikeService.java': [
      'package com.demo;',
      'import org.springframework.stereotype.Service;',
      'import org.springframework.transaction.annotation.Transactional;',
      '@Service',
      'public class LikeService {',
      '  private final LikeMapper likeMapper = new LikeMapperImpl();',
      '  /** 用户点赞主流程 */',
      '  @Transactional',
      '  public String doLike(long id) {',
      '    likeMapper.insertLike(id);',
      '    return "ok";',
      '  }',
      '}',
      ''
    ].join('\n'),
    // No Java impl on purpose: a bare @Mapper interface is backed by XML, and
    // the chain must land on the mapperStatements DATA_MAPPER hop.
    'src/main/java/com/demo/LikeMapper.java': [
      'package com.demo;',
      'import org.apache.ibatis.annotations.Mapper;',
      '@Mapper',
      'public interface LikeMapper {',
      '  void insertLike(long id);',
      '}',
      ''
    ].join('\n'),
    'src/main/resources/mapper/LikeMapper.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<mapper namespace="com.demo.LikeMapper">',
      '  <insert id="insertLike">',
      '    INSERT INTO likes(post_id) VALUES (#{id})',
      '  </insert>',
      '</mapper>',
      ''
    ].join('\n'),
    // Interface-level @Transactional: the impl method carries no annotation.
    'src/main/java/com/demo/TxService.java': [
      'package com.demo;',
      'import org.springframework.transaction.annotation.Transactional;',
      'public interface TxService {',
      '  @Transactional(readOnly = true)',
      '  String transfer(long id);',
      '}',
      ''
    ].join('\n'),
    'src/main/java/com/demo/TxServiceImpl.java': [
      'package com.demo;',
      'public class TxServiceImpl implements TxService {',
      '  public String transfer(long id) { return "moved"; }',
      '}',
      ''
    ].join('\n'),
    // Legacy module being decommissioned, with a two-wave orphan cascade.
    'src/main/java/com/demo/legacy/LegacyController.java': [
      'package com.demo.legacy;',
      'import org.springframework.web.bind.annotation.*;',
      '@RestController',
      '@RequestMapping("/legacy")',
      'public class LegacyController {',
      '  private final LegacyService legacyService = new LegacyService();',
      '  @GetMapping',
      '  public String legacyPing() {',
      '    return legacyService.doLegacy();',
      '  }',
      '}',
      ''
    ].join('\n'),
    'src/main/java/com/demo/legacy/LegacyService.java': [
      'package com.demo.legacy;',
      'public class LegacyService {',
      '  public String doLegacy() {',
      '    return LegacyHelper.formatLegacy("x");',
      '  }',
      '}',
      ''
    ].join('\n'),
    'src/main/java/com/demo/common/LegacyHelper.java': [
      'package com.demo.common;',
      'public class LegacyHelper {',
      '  public static String formatLegacy(String value) {',
      '    return LegacyPad.padDay(value);',
      '  }',
      '}',
      ''
    ].join('\n'),
    'src/main/java/com/demo/common/LegacyPad.java': [
      'package com.demo.common;',
      'public class LegacyPad {',
      '  public static String padDay(String value) { return value; }',
      '}',
      ''
    ].join('\n'),
    // Live code keeps its own DTO alive — must NOT be reported orphaned.
    'src/main/java/com/demo/MoneyDto.java': [
      'package com.demo;',
      'public class MoneyDto {',
      '  public String amount;',
      '}',
      ''
    ].join('\n'),
    'src/main/java/com/demo/LiveService.java': [
      'package com.demo;',
      'public class LiveService {',
      '  public String pay(MoneyDto money) { return money.amount; }',
      '}',
      ''
    ].join('\n'),
    'README.md': [
      '# Social Demo',
      '',
      '包含用户点赞主流程与遗留打卡模块。',
      ''
    ].join('\n')
  }
};
export const GOLDEN_FIXTURES: EvalFixture[] = [repoA, repoB, repoC, repoD];

export const GOLDEN_DATASET: EvalQuestion[] = [
  ...Array.from({ length: 20 }, (_, index) => ({
    id: `route-${index + 1}`,
    fixture: index < 10 ? 'repo-a' : 'repo-b',
    mode: 'route-chain' as const,
    question: index < 10 ? 'trace hello' : index % 2 === 0 ? 'trace createOrder' : 'trace listOrders',
    expected: index < 10 ? ['hello', 'greet'] : index % 2 === 0 ? ['createOrder', 'create'] : ['listOrders', 'list']
  })),
  ...Array.from({ length: 15 }, (_, index) => ({
    id: `config-${index + 1}`,
    fixture: index < 6 ? 'repo-a' : index < 11 ? 'repo-b' : 'repo-c',
    mode: 'config' as const,
    question: index < 6 ? 'spring datasource password' : index < 11 ? 'order datasource url' : 'app name',
    expected:
      index < 6
        ? ['spring.datasource.password']
        : index < 11
          ? ['order.datasource.url']
          : ['app.name']
  })),
  ...Array.from({ length: 15 }, (_, index) => ({
    id: `architecture-${index + 1}`,
    fixture: index < 6 ? 'repo-a' : index < 11 ? 'repo-b' : 'repo-c',
    mode: 'architecture' as const,
    question:
      index < 6 ? 'Controller DemoService' :
      index < 11 ? 'OrderController OrderService' :
      index % 2 === 0 ? 'Calculator add subtract' : 'StringUtils slugify',
    expected:
      index < 6 ? ['Controller', 'DemoService'] :
      index < 11 ? ['OrderController', 'OrderService'] :
      index % 2 === 0 ? ['Calculator', 'add', 'subtract'] : ['StringUtils', 'slugify']
  })),
  // v0.13 — composite-engine buckets (real engine calls, not name lookups).
  ...[
    { id: 'intent-1', query: '用户点赞', expected: ['doLike'] },
    { id: 'intent-2', query: 'doLike', expected: ['doLike'] },
    { id: 'intent-3', query: 'likePost', expected: ['likePost'] },
    { id: 'intent-4', query: 'transfer', expected: ['transfer'] },
    { id: 'intent-5', query: 'legacyPing', expected: ['legacyPing'] }
  ].map((item) => ({
    id: item.id,
    fixture: 'repo-d',
    mode: 'intent-anchor' as const,
    question: item.query,
    expected: item.expected
  })),
  ...[
    {
      id: 'diag-1',
      entry: 'POST /posts/123/like',
      expected: ['likePost', 'doLike', 'insertLike'],
      expectedBreak: false
    },
    {
      id: 'diag-2',
      entry: 'likePost',
      expected: ['likePost', 'doLike', 'insertLike'],
      expectedBreak: false
    },
    {
      id: 'diag-3',
      entry: 'GET /legacy',
      expected: ['legacyPing', 'doLegacy', 'formatLegacy'],
      expectedBreak: false
    },
    {
      id: 'diag-4',
      entry: 'POST /posts/999/missing',
      expected: [],
      expectedBreak: true
    },
    {
      id: 'diag-5',
      entry: 'doLike',
      expected: ['doLike', 'insertLike'],
      expectedBreak: false
    }
  ].map((item) => ({
    id: item.id,
    fixture: 'repo-d',
    mode: 'diagnose-chain' as const,
    question: item.entry,
    expected: item.expected,
    expectedBreak: item.expectedBreak
  })),
  ...[
    { id: 'evo-1', intent: 'deprecate', target: 'src/main/java/com/demo/legacy', expected: ['formatLegacy', 'padDay'], absent: ['likePost', 'transfer'] },
    { id: 'evo-2', intent: 'deprecate', target: 'LegacyController', expected: ['formatLegacy', 'padDay'], absent: ['likePost'] },
    { id: 'evo-3', intent: 'deprecate', target: 'src/main/java/com/demo/legacy', expected: [], absent: ['likePost', 'doLike', 'transfer'] },
    { id: 'evo-4', intent: 'extend', target: 'doLike', goal: '异步能量结算', expected: ['METHOD', 'SPRING_EVENT_ASYNC'] },
    { id: 'evo-5', intent: 'extend', target: 'transfer', expected: ['INTERFACE'] }
  ].map((item) => ({
    id: item.id,
    fixture: 'repo-d',
    mode: 'evolution' as const,
    question: `${item.intent}:${item.target}`,
    expected: item.expected,
    ...(item.absent ? { expectedAbsent: item.absent } : {}),
    ...(item.goal ? { goal: item.goal } : {})
  }))
];

export async function materializeFixture(fixture: EvalFixture): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `repoqa-eval-${fixture.name}-`));
  for (const [relativePath, content] of Object.entries(fixture.files)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

export async function commitFixture(root: string): Promise<string> {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'RepoPulse',
    GIT_AUTHOR_EMAIL: 'repoqa@local',
    GIT_COMMITTER_NAME: 'RepoPulse',
    GIT_COMMITTER_EMAIL: 'repoqa@local',
    GIT_AUTHOR_DATE: '2020-01-01T00:00:00+00:00',
    GIT_COMMITTER_DATE: '2020-01-01T00:00:00+00:00'
  };
  await execFile('git', ['init', '-q'], { cwd: root, env: gitEnv });
  await execFile('git', ['add', '-A'], { cwd: root, env: gitEnv });
  await execFile('git', ['commit', '-q', '-m', 'repoqa golden fixture'], {
    cwd: root,
    env: gitEnv
  });
  const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    env: gitEnv
  });
  return stdout.trim();
}

export async function runGoldenEval(recordTo?: RepoQARepos): Promise<EvalReport> {
  const roots = new Map<string, string>();
  const fixtureCommits = new Map<string, string>();
  const symbolsByFixture = new Map<string, ReturnType<RepoQARepos['listSymbols']>>();
  const indexByFixture = new Map<string, ReturnType<typeof buildCallIndex>>();
  const repoIdByFixture = new Map<string, string>();
  const repoqaByFixture = new Map<string, RepoQARepos>();
  let parseFailures = 0;

  for (const fixture of GOLDEN_FIXTURES) {
    const root = await materializeFixture(fixture);
    roots.set(fixture.name, root);
    fixtureCommits.set(fixture.name, await commitFixture(root));
    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    const worker = new RepoQAWorker(repoqa, new EventBus());
    const result = await worker.indexRepo({ localPath: root });
    if (result.repo.status === 'error') parseFailures += 1;
    const symbols = repoqa.listSymbols(result.repo.id);
    symbolsByFixture.set(fixture.name, symbols);
    indexByFixture.set(fixture.name, buildCallIndex(symbols));
    repoIdByFixture.set(fixture.name, result.repo.id);
    repoqaByFixture.set(fixture.name, repoqa);
  }

  const metrics = {
    'route-chain': { matched: 0, expected: 0, anchors: 0, invalid: 0, hallucinated: 0, latency: 0, total: 0 },
    config: { matched: 0, expected: 0, anchors: 0, invalid: 0, hallucinated: 0, latency: 0, total: 0 },
    architecture: { matched: 0, expected: 0, anchors: 0, invalid: 0, hallucinated: 0, latency: 0, total: 0 },
    'intent-anchor': { matched: 0, expected: 0, anchors: 0, invalid: 0, hallucinated: 0, latency: 0, total: 0 },
    'diagnose-chain': { matched: 0, expected: 0, anchors: 0, invalid: 0, hallucinated: 0, latency: 0, total: 0 },
    evolution: { matched: 0, expected: 0, anchors: 0, invalid: 0, hallucinated: 0, latency: 0, total: 0 }
  };

  for (const question of GOLDEN_DATASET) {
    const symbols = symbolsByFixture.get(question.fixture) ?? [];
    const bucket = metrics[question.mode];
    bucket.total += 1;
    const start = Date.now();

    if (question.mode === 'route-chain') {
      const startSymbol = symbols.find(
        (symbol) => symbol.kind === 'method' && symbol.name === question.expected[0]
      );
      if (startSymbol) {
        const trace = resolveCallChain(symbols, startSymbol);
        const resolved = trace.filter((hop) => !hop.break);
        const topNames = resolved.slice(0, RECALL_K).map((hop) => hop.method);
        question.expected.forEach((name) => {
          bucket.expected += 1;
          if (topNames.includes(name)) bucket.matched += 1;
        });
        resolved.forEach((hop) => {
          bucket.anchors += 1;
          if (!question.expected.includes(hop.method)) bucket.hallucinated += 1;
        });
      }
    } else if (question.mode === 'config') {
      const configs = symbols.filter((symbol) => symbol.kind === 'config');
      const nameSet = new Set(configs.map((symbol) => symbol.name.trim()));
      question.expected.forEach((name) => {
        bucket.expected += 1;
        if (nameSet.has(name)) {
          bucket.matched += 1;
          bucket.anchors += 1;
        }
      });
    } else if (question.mode === 'architecture') {
      const nameSet = new Set(
        symbols
        .filter((symbol) =>
          ['class', 'interface', 'route', 'service', 'method', 'field'].includes(symbol.kind)
        )
        .map((symbol) => symbol.name)
      );
      question.expected.forEach((name) => {
        bucket.expected += 1;
        if (nameSet.has(name)) {
          bucket.matched += 1;
          bucket.anchors += 1;
        }
      });
    }

    if (question.mode === 'intent-anchor') {
      const repoqa = repoqaByFixture.get(question.fixture);
      const chunkHitFiles = repoqa
        ? repoqa
            .searchChunks(repoIdByFixture.get(question.fixture)!, question.question)
            .map((chunk) => chunk.filePath)
            .filter((file): file is string => Boolean(file))
        : undefined;
      const radar = runDomainRadar({
        repoId: repoIdByFixture.get(question.fixture) ?? question.fixture,
        query: question.question,
        symbols,
        index: indexByFixture.get(question.fixture)!,
        ...(chunkHitFiles ? { chunkHitFiles } : {})
      });
      // An anchor matches when its qualified name ends with the expected
      // symbol (radar reports `Parent.symbol` for typed members).
      const anchorNames = radar.matchedAnchors.map((anchor) => anchor.symbol);
      question.expected.forEach((name) => {
        bucket.expected += 1;
        if (anchorNames.some((qualified) => qualified === name || qualified.endsWith(`.${name}`))) {
          bucket.matched += 1;
          bucket.anchors += 1;
        }
      });
    } else if (question.mode === 'diagnose-chain') {
      const result = runDiagnose({
        repoId: repoIdByFixture.get(question.fixture) ?? question.fixture,
        entrySymbol: question.question,
        symbols,
        index: indexByFixture.get(question.fixture)!
      });
      const chainSymbols = result.verifiedChain.map((step) => step.symbol);
      question.expected.forEach((name) => {
        bucket.expected += 1;
        if (chainSymbols.includes(name)) bucket.matched += 1;
      });
      bucket.anchors += 1;
      const anyBroken = result.verifiedChain.some((step) => step.status === 'BROKEN');
      if (anyBroken !== (question.expectedBreak ?? false)) bucket.hallucinated += 1;
    } else if (question.mode === 'evolution') {
      const [intent, target] = question.question.split(':');
      const result = runModuleEvolution({
        repoId: repoIdByFixture.get(question.fixture) ?? question.fixture,
        intentType: intent as 'DEPRECATE' | 'EXTEND',
        targetSymbolOrModule: target,
        ...(question.goal ? { extensionGoal: question.goal } : {}),
        symbols,
        index: indexByFixture.get(question.fixture)!
      });
      if (result.intentType === 'DEPRECATE') {
        const orphaned = result.blastRadius.orphanedSymbols.map((symbol) => symbol.name);
        question.expected.forEach((name) => {
          bucket.expected += 1;
          if (orphaned.includes(name)) bucket.matched += 1;
        });
        bucket.anchors += orphaned.length;
        for (const name of question.expectedAbsent ?? []) {
          if (orphaned.includes(name)) bucket.hallucinated += 1;
        }
      } else {
        const evidence = new Set<string>([
          ...result.transactionBoundaries.map((boundary) => boundary.scope),
          ...(result.scaffoldTemplates ?? []).map((scaffold) => scaffold.suggestedPattern)
        ]);
        question.expected.forEach((name) => {
          bucket.expected += 1;
          if (evidence.has(name)) {
            bucket.matched += 1;
            bucket.anchors += 1;
          }
        });
      }
    }

    bucket.latency += Date.now() - start;
  }

  const buckets = Object.fromEntries(
    Object.entries(metrics).map(([name, bucket]) => {
      const recallAtK =
        bucket.expected > 0 ? (bucket.matched / bucket.expected) * 100 : 100;
      const hallucinationRate =
        bucket.anchors > 0 ? (bucket.hallucinated / bucket.anchors) * 100 : 0;
      const anchorValidity =
        bucket.anchors > 0 ? ((bucket.anchors - bucket.invalid) / bucket.anchors) * 100 : 100;
      const avgLatencyMs = bucket.total > 0 ? bucket.latency / bucket.total : 0;
      return [name, {
        total: bucket.total,
        recallAtK,
        hallucinationRate,
        anchorValidity,
        avgLatencyMs
      }];
    })
  ) as EvalReport['buckets'];

  const generationFailures = Math.min(
    1,
    Object.values(buckets).filter(
      (bucket) => bucket.hallucinationRate > EVAL_PASS_THRESHOLDS.hallucinationRateMax
    ).length
  );
  const anchorFailures = Math.min(
    1,
    Object.values(buckets).filter(
      (bucket) => bucket.anchorValidity < EVAL_PASS_THRESHOLDS.anchorValidity
    ).length
  );
  const retrievalFailures = Math.min(
    1,
    Object.values(buckets).filter(
      (bucket) => bucket.recallAtK < EVAL_PASS_THRESHOLDS.recallAtK
    ).length
  );

  for (const root of roots.values()) {
    await fs.rm(root, { recursive: true, force: true });
  }

  const passed =
    parseFailures === 0 &&
    Object.values(buckets).every((bucket) => bucketPasses(bucket));

  const report: EvalReport = {
    passed,
    totalQuestions: GOLDEN_DATASET.length,
    fixtureCommits: Object.fromEntries(fixtureCommits),
    buckets,
    failureTaxonomy: {
      parse: parseFailures,
      retrieval: retrievalFailures,
      generation: generationFailures,
      anchor: anchorFailures
    }
  };

  if (recordTo) recordEvalReport(recordTo, report);
  return report;
}

/**
 * Issue 09: write a golden-eval run onto the local evidence plane
 * (`repoqa_events`) — one `eval.run` summary plus one `eval.bucket` event per
 * bucket with its recall/hallucination/anchor metrics. The eval owns no repo,
 * so these events carry no repoId; `failureClass` carries the guardrail outcome.
 */
export function recordEvalReport(repoqa: RepoQARepos, report: EvalReport): void {
  repoqa.recordEvent({
    eventType: 'eval.run',
    intent: 'golden-eval',
    feedback: JSON.stringify({
      passed: report.passed,
      totalQuestions: report.totalQuestions,
      fixtureCommits: report.fixtureCommits,
      buckets: report.buckets,
      failureTaxonomy: report.failureTaxonomy
    }),
    failureClass: report.passed ? undefined : 'eval-failed'
  });
  for (const [mode, bucket] of Object.entries(report.buckets)) {
    repoqa.recordEvent({
      eventType: 'eval.bucket',
      intent: mode,
      feedback: JSON.stringify({
        total: bucket.total,
        recallAtK: bucket.recallAtK,
        hallucinationRate: bucket.hallucinationRate,
        anchorValidity: bucket.anchorValidity,
        avgLatencyMs: bucket.avgLatencyMs
      }),
      failureClass: bucketPasses(bucket) ? undefined : 'threshold-miss'
    });
  }
}

if (process.argv[1]?.endsWith('repoqa-eval.ts')) {
  runGoldenEval().then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  });
}
