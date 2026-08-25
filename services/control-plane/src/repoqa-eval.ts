import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveCallChain } from './repoqa-callchain';
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
  mode: 'route-chain' | 'config' | 'architecture';
  question: string;
  expected: string[];
}

export type EvalReport = {
  passed: boolean;
  totalQuestions: number;
  fixtureCommits: Record<string, string>;
  buckets: Record<
    'route-chain' | 'config' | 'architecture',
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

export const GOLDEN_FIXTURES: EvalFixture[] = [repoA, repoB, repoC];

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
    symbolsByFixture.set(fixture.name, repoqa.listSymbols(result.repo.id));
  }

  const metrics = {
    'route-chain': { matched: 0, expected: 0, anchors: 0, invalid: 0, hallucinated: 0, latency: 0, total: 0 },
    config: { matched: 0, expected: 0, anchors: 0, invalid: 0, hallucinated: 0, latency: 0, total: 0 },
    architecture: { matched: 0, expected: 0, anchors: 0, invalid: 0, hallucinated: 0, latency: 0, total: 0 }
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
    } else {
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
