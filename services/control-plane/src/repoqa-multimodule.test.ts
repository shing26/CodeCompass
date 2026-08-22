import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from './db';
import { EventBus } from './events';
import type { RepoSymbol } from './repoqa-repos';
import { RepoQARepos } from './repoqa-repos';
import { parseJavaFile, parsePomModules } from './repoqa-parser';
import { detectMavenModules, mavenSourceRoots } from './repoqa-scan';
import { extractConfigSymbols } from './repoqa-config';
import {
  STATIC_ANALYSIS_BREAK_DYNAMIC,
  resolveCallChain
} from './repoqa-callchain';
import { buildDashboard } from './repoqa-dashboard';
import { RepoQAWorker } from './repoqa-worker';

/**
 * Issue 15 — multi-module Maven support.
 *
 * Fixture: parent pom declaring api/service/dao modules; a Controller (api)
 * calls an ApplicationService (service) which calls a Mapper interface (dao)
 * implemented only by MyBatisOrderMapper (dao). Every hop crosses a module
 * boundary, so the tests prove the symbol table resolves cross-directory
 * sources with repo-root-relative paths and exact line numbers.
 */

const PARENT_POM = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.shop</groupId>
  <artifactId>mall</artifactId>
  <version>1.0.0</version>
  <packaging>pom</packaging>
  <modules>
    <module>api</module>
    <module>service</module>
    <module>dao</module>
  </modules>
</project>
`;

const API_POM =
  '<project>\n  <parent>\n    <groupId>com.shop</groupId>\n    <artifactId>mall</artifactId>\n    <version>1.0.0</version>\n  </parent>\n  <artifactId>mall-api</artifactId>\n</project>\n';
const SERVICE_POM =
  '<project>\n  <artifactId>mall-service</artifactId>\n</project>\n';
const DAO_POM =
  '<project>\n  <artifactId>mall-dao</artifactId>\n  <dependencies>\n    <dependency>\n      <groupId>org.mybatis</groupId>\n      <artifactId>mybatis</artifactId>\n    </dependency>\n  </dependencies>\n</project>\n';

const ORDER_CONTROLLER = `package com.shop.api;

import com.shop.service.OrderApplicationService;

@RestController
public class OrderController {
  private final OrderApplicationService orderApplicationService = new OrderApplicationService();

  @PostMapping("/orders")
  public String createOrder() {
    return orderApplicationService.submitOrder();
  }

  @GetMapping("/orders/{id}")
  public String getOrder(long id) {
    return orderApplicationService.findOrderById(id);
  }
}
`;

const ORDER_APPLICATION_SERVICE = `package com.shop.service;

import com.shop.dao.OrderMapper;

@Service
public class OrderApplicationService {
  private final OrderMapper orderMapper = new MyBatisOrderMapper();

  public String submitOrder() {
    return orderMapper.insert("{}");
  }

  public String findOrderById(long id) {
    return orderMapper.selectById(id);
  }
}
`;

const ORDER_MAPPER = `package com.shop.dao;

public interface OrderMapper {
  String insert(String payload);
  String selectById(long id);
}
`;

const MYBATIS_ORDER_MAPPER = `package com.shop.dao;

@Repository
public class MyBatisOrderMapper implements OrderMapper {
  public String insert(String payload) {
    return "inserted";
  }

  public String selectById(long id) {
    return "order-" + id;
  }
}
`;

const PAYMENT_MAPPER = `package com.shop.dao;

public interface PaymentMapper {
  void pay(double amount);
}
`;

const PAYMENT_SERVICE = `package com.shop.service;

import com.shop.dao.PaymentMapper;

@Service
public class PaymentService {
  private final PaymentMapper paymentMapper = null;

  public String checkout() {
    return paymentMapper.pay(1.0);
  }
}
`;

const SERVICE_APPLICATION_YML = `spring:
  datasource:
    url: jdbc:mysql://localhost/shop
`;

const MULTI_MODULE_FILES: Record<string, string> = {
  'pom.xml': PARENT_POM,
  'api/pom.xml': API_POM,
  'service/pom.xml': SERVICE_POM,
  'dao/pom.xml': DAO_POM,
  'api/src/main/java/com/shop/api/OrderController.java': ORDER_CONTROLLER,
  'service/src/main/java/com/shop/service/OrderApplicationService.java':
    ORDER_APPLICATION_SERVICE,
  'service/src/main/java/com/shop/service/PaymentService.java': PAYMENT_SERVICE,
  'dao/src/main/java/com/shop/dao/OrderMapper.java': ORDER_MAPPER,
  'dao/src/main/java/com/shop/dao/MyBatisOrderMapper.java': MYBATIS_ORDER_MAPPER,
  'dao/src/main/java/com/shop/dao/PaymentMapper.java': PAYMENT_MAPPER,
  'service/src/main/resources/application.yml': SERVICE_APPLICATION_YML
};

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
}

async function materializeFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-multimodule-'));
  await writeTree(root, MULTI_MODULE_FILES);
  return root;
}

async function parseFixture(
  root: string
): Promise<{ symbols: RepoSymbol[]; configSymbols: RepoSymbol[] }> {
  const files = await Promise.all(
    Object.keys(MULTI_MODULE_FILES).map((rel) => path.join(root, rel))
  );
  const symbols: RepoSymbol[] = [];
  for (const filePath of files.filter((file) => file.endsWith('.java'))) {
    symbols.push(...(await parseJavaFile(filePath, 'r', root)));
  }
  const configSymbols = await extractConfigSymbols('r', root, files);
  return { symbols, configSymbols };
}

describe('parsePomModules — parent pom <modules> (Issue 15)', () => {
  it('returns declared modules in order with source lines', () => {
    expect(parsePomModules(PARENT_POM)).toEqual([
      { name: 'api', lineStart: 9 },
      { name: 'service', lineStart: 10 },
      { name: 'dao', lineStart: 11 }
    ]);
  });

  it('trims whitespace around module names and tolerates multi-line tags', () => {
    const source =
      '<project>\n  <modules>\n    <module>\n      web\n    </module>\n    <module>   batch   </module>\n  </modules>\n</project>\n';
    expect(parsePomModules(source)).toEqual([
      { name: 'web', lineStart: 3 },
      { name: 'batch', lineStart: 6 }
    ]);
  });

  it('ignores <module> tags outside a <modules> block and empty poms', () => {
    expect(
      parsePomModules(
        '<project><plugin><configuration><module>fake</module></configuration></plugin></project>'
      )
    ).toEqual([]);
    expect(parsePomModules('<project>\n  <artifactId>demo</artifactId>\n</project>\n')).toEqual([]);
    expect(parsePomModules('')).toEqual([]);
  });
});

describe('detectMavenModules / mavenSourceRoots — repo layout (Issue 15)', () => {
  it('detects modules whose own pom exists, in declared order', async () => {
    const root = await materializeFixture();
    try {
      const modules = await detectMavenModules(root);
      expect(modules).toEqual([
        { name: 'api', dir: 'api', pomPath: 'api/pom.xml' },
        { name: 'service', dir: 'service', pomPath: 'service/pom.xml' },
        { name: 'dao', dir: 'dao', pomPath: 'dao/pom.xml' }
      ]);
      expect(await mavenSourceRoots(root, modules)).toEqual([
        { module: 'api', path: 'src/main/java' },
        { module: 'service', path: 'src/main/java' },
        { module: 'service', path: 'src/main/resources' },
        { module: 'dao', path: 'src/main/java' }
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('skips declared modules without their own pom and rejects traversal names', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-modules-skip-'));
    try {
      await writeTree(root, {
        'pom.xml':
          '<project>\n  <modules>\n    <module>api</module>\n    <module>ghost</module>\n    <module>../escape</module>\n  </modules>\n</project>\n',
        'api/pom.xml': '<project></project>\n'
      });
      expect(await detectMavenModules(root)).toEqual([
        { name: 'api', dir: 'api', pomPath: 'api/pom.xml' }
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns [] for single-module repos or missing poms', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-modules-empty-'));
    try {
      await writeTree(root, {
        'pom.xml': '<project>\n  <artifactId>single</artifactId>\n</project>\n'
      });
      expect(await detectMavenModules(root)).toEqual([]);

      const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-modules-bare-'));
      try {
        expect(await detectMavenModules(bare)).toEqual([]);
      } finally {
        await fs.rm(bare, { recursive: true, force: true });
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('resolveCallChain — cross-module api → service → dao (Issue 15)', () => {
  let root: string;
  let symbols: RepoSymbol[];

  beforeAll(async () => {
    root = await materializeFixture();
    symbols = (await parseFixture(root)).symbols;
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('resolves createOrder → submitOrder → MyBatisOrderMapper.insert with cross-module files and lines', async () => {
    const start = symbols.find((s) => s.name === 'createOrder')!;
    const trace = resolveCallChain(symbols, start);
    expect(trace.map((hop) => hop.method)).toEqual([
      'createOrder',
      'submitOrder',
      'insert'
    ]);
    expect(trace.map((hop) => hop.file)).toEqual([
      'api/src/main/java/com/shop/api/OrderController.java',
      'service/src/main/java/com/shop/service/OrderApplicationService.java',
      'dao/src/main/java/com/shop/dao/MyBatisOrderMapper.java'
    ]);
    expect(trace.some((hop) => hop.break)).toBe(false);
    expect(trace[1]).toEqual(
      expect.objectContaining({ line: 9, lineEnd: 11, callLine: 11 })
    );
    expect(trace[2]).toEqual(
      expect.objectContaining({ line: 5, lineEnd: 7, callLine: 10 })
    );
  });

  it('resolves getOrder → findOrderById → MyBatisOrderMapper.selectById', async () => {
    const start = symbols.find((s) => s.name === 'getOrder')!;
    const trace = resolveCallChain(symbols, start);
    expect(trace.map((hop) => hop.method)).toEqual([
      'getOrder',
      'findOrderById',
      'selectById'
    ]);
    expect(trace[1]).toEqual(
      expect.objectContaining({ line: 13, lineEnd: 15, callLine: 16 })
    );
    expect(trace[2]).toEqual(
      expect.objectContaining({ file: 'dao/src/main/java/com/shop/dao/MyBatisOrderMapper.java', line: 9, callLine: 14 })
    );
  });

  it('breaks deterministically when a Mapper interface has no Java implementation', async () => {
    const start = symbols.find((s) => s.name === 'checkout')!;
    const trace = resolveCallChain(symbols, start);
    expect(trace.map((hop) => hop.method)).toEqual(['checkout', 'pay']);
    expect(trace[1]).toEqual(
      expect.objectContaining({
        file: 'service/src/main/java/com/shop/service/PaymentService.java',
        break: true,
        reason: STATIC_ANALYSIS_BREAK_DYNAMIC,
        callLine: 10
      })
    );
  });
});

describe('extractConfigSymbols — module-scoped config (Issue 15)', () => {
  it('indexes submodule resources and submodule poms with repo-root-relative paths', async () => {
    const root = await materializeFixture();
    try {
      const { configSymbols } = await parseFixture(root);
      const url = configSymbols.find((s) => s.name === 'spring.datasource.url')!;
      expect(url).toMatchObject({
        filePath: 'service/src/main/resources/application.yml',
        lineStart: 3
      });
      const mybatis = configSymbols.find((s) => s.name === 'org.mybatis:mybatis')!;
      expect(mybatis).toMatchObject({ filePath: 'dao/pom.xml', lineStart: 6 });
      // Parent pom modules are not config keys; only real dependency components are.
      expect(configSymbols.some((s) => s.name === 'api' || s.name === 'mall-api')).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('buildDashboard — cross-module scale and top APIs (Issue 15)', () => {
  it('counts cross-module files and ranks controller endpoints by chain depth', async () => {
    const root = await materializeFixture();
    try {
      const { symbols, configSymbols } = await parseFixture(root);
      const dashboard = buildDashboard({ repoId: 'r', symbols: [...symbols, ...configSymbols] });

      expect(dashboard.scale.files).toBeGreaterThanOrEqual(8);
      expect([...new Set(symbols.map((s) => s.filePath))]).toEqual(
        expect.arrayContaining([
          'api/src/main/java/com/shop/api/OrderController.java',
          'service/src/main/java/com/shop/service/OrderApplicationService.java',
          'dao/src/main/java/com/shop/dao/MyBatisOrderMapper.java'
        ])
      );
      expect(dashboard.scale.routes).toBe(1);
      expect(dashboard.scale.services).toBe(2); // OrderApplicationService + PaymentService
      expect(dashboard.scale.repositories).toBe(1); // MyBatisOrderMapper

      expect(dashboard.topApis[0]).toEqual(
        expect.objectContaining({
          name: 'createOrder',
          controller: 'OrderController',
          filePath: 'api/src/main/java/com/shop/api/OrderController.java',
          depth: 3,
          hops: ['createOrder', 'submitOrder', 'insert']
        })
      );
      expect(dashboard.topApis[1]).toEqual(
        expect.objectContaining({
          name: 'getOrder',
          hops: ['getOrder', 'findOrderById', 'selectById']
        })
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('resolveCallChain — deterministic name-based fallback (Issue 15)', () => {
  const legacy: RepoSymbol[] = [
    {
      repoId: 'r',
      kind: 'class',
      name: 'ApiStarter',
      filePath: 'api/ApiStarter.java',
      lineStart: 1,
      lineEnd: 10
    },
    {
      repoId: 'r',
      kind: 'method',
      name: 'start',
      filePath: 'api/ApiStarter.java',
      lineStart: 2,
      lineEnd: 4,
      parentType: 'ApiStarter',
      calls: [{ file: 'api/ApiStarter.java', method: 'build' }]
    },
    {
      repoId: 'r',
      kind: 'method',
      name: 'build',
      filePath: 'api/ApiStarter.java',
      lineStart: 4,
      lineEnd: 6,
      parentType: 'ApiStarter',
      calls: []
    },
    {
      repoId: 'r',
      kind: 'class',
      name: 'Runtime',
      filePath: 'service/Runtime.java',
      lineStart: 1,
      lineEnd: 10
    },
    {
      repoId: 'r',
      kind: 'method',
      name: 'build',
      filePath: 'service/Runtime.java',
      lineStart: 1,
      lineEnd: 3,
      parentType: 'Runtime',
      calls: []
    },
    {
      repoId: 'r',
      kind: 'class',
      name: 'Persist',
      filePath: 'dao/Persist.java',
      lineStart: 1,
      lineEnd: 10
    },
    {
      repoId: 'r',
      kind: 'method',
      name: 'build',
      filePath: 'dao/Persist.java',
      lineStart: 9,
      lineEnd: 11,
      parentType: 'Persist',
      calls: []
    },
    {
      repoId: 'r',
      kind: 'class',
      name: 'Boot',
      filePath: 'bootstrap/Boot.java',
      lineStart: 1,
      lineEnd: 10
    },
    {
      repoId: 'r',
      kind: 'method',
      name: 'boot',
      filePath: 'bootstrap/Boot.java',
      lineStart: 2,
      lineEnd: 4,
      parentType: 'Boot',
      calls: [{ file: 'bootstrap/Boot.java', method: 'build' }]
    }
  ];

  it('prefers the caller file when several modules declare the same method name', () => {
    const start = legacy.find((s) => s.name === 'start')!;
    const trace = resolveCallChain(legacy, start);
    expect(trace.map((hop) => hop.method)).toEqual(['start', 'build']);
    expect(trace[1].file).toBe('api/ApiStarter.java');
    expect(trace[1].line).toBe(4);
  });

  it('falls back to the earliest declaration when no same-file candidate exists', () => {
    const boot = legacy.find((s) => s.name === 'boot')!;
    const trace = resolveCallChain(legacy, boot);
    expect(trace.map((hop) => hop.method)).toEqual(['boot', 'build']);
    expect(trace[1].file).toBe('service/Runtime.java');
    expect(trace[1].line).toBe(1);
  });
});

describe('RepoQAWorker — multi-module indexing (Issue 15)', () => {
  it('indexes the reactor root, reports modules on the evidence plane, and keeps cross-module symbols', async () => {
    const root = await materializeFixture();
    const db = openDb(':memory:');
    try {
      const repoqa = new RepoQARepos(db);
      const worker = new RepoQAWorker(repoqa, new EventBus());
      const result = await worker.indexRepo({ localPath: root });
      expect(result.repo.status).toBe('ready');

      const symbols = repoqa.listSymbols(result.repo.id);
      expect(symbols.some((s) => s.name === 'createOrder' && s.filePath.startsWith('api/'))).toBe(true);
      expect(symbols.some((s) => s.name === 'submitOrder' && s.filePath.startsWith('service/'))).toBe(true);
      expect(symbols.some((s) => s.name === 'selectById' && s.filePath.startsWith('dao/'))).toBe(true);

      const { events } = repoqa.listEvents();
      const moduleEvent = events.find((e) => e.eventType === 'repoqa.modules.detected');
      expect(moduleEvent).toBeDefined();
      const payload = JSON.parse(moduleEvent!.feedback ?? '{}') as {
        moduleCount: number;
        modules: Array<{ name: string; pomPath: string }>;
      };
      expect(payload.moduleCount).toBe(3);
      expect(payload.modules).toEqual([
        { name: 'api', pomPath: 'api/pom.xml' },
        { name: 'service', pomPath: 'service/pom.xml' },
        { name: 'dao', pomPath: 'dao/pom.xml' }
      ]);

      // Cross-module chain resolves straight out of the indexed symbol table.
      const createOrder = symbols.find((s) => s.name === 'createOrder')!;
      const trace = resolveCallChain(symbols, createOrder);
      expect(trace.map((hop) => hop.file)).toEqual([
        'api/src/main/java/com/shop/api/OrderController.java',
        'service/src/main/java/com/shop/service/OrderApplicationService.java',
        'dao/src/main/java/com/shop/dao/MyBatisOrderMapper.java'
      ]);
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not emit a modules event for single-module repos', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-single-module-'));
    const db = openDb(':memory:');
    try {
      await writeTree(root, {
        'pom.xml': '<project><artifactId>single</artifactId></project>\n',
        'src/main/java/com/demo/App.java': 'package com.demo;\npublic class App {}\n'
      });
      const repoqa = new RepoQARepos(db);
      const worker = new RepoQAWorker(repoqa, new EventBus());
      await worker.indexRepo({ localPath: root });
      const { events } = repoqa.listEvents();
      expect(events.some((e) => e.eventType === 'repoqa.modules.detected')).toBe(false);
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});