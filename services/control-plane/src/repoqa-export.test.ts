import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RepoSymbol } from './repoqa-repos';
import { parseJavaFile } from './repoqa-parser';
import { extractConfigSymbols } from './repoqa-config';
import {
  buildOnboardingMarkdown,
  onboardingExportFileName,
  sanitizeFileName
} from './repoqa-export';

/** Parse java sources + config files (yml/properties/pom) into one symbol list. */
async function parseTree(files: Record<string, string>): Promise<RepoSymbol[]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-export-'));
  const filePaths = Object.keys(files).map((rel) => path.join(root, rel));
  const symbols: RepoSymbol[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  for (const file of filePaths) {
    if (file.endsWith('.java')) symbols.push(...(await parseJavaFile(file, 'repo-test', root)));
  }
  symbols.push(...(await extractConfigSymbols('repo-test', root, filePaths)));
  return symbols;
}

/**
 * A spring-ish repo with deps + config + REST layers + a Filter and a
 * @RestControllerAdvice, so the dashboard AND all three tours populate.
 */
const FULL_REPO: Record<string, string> = {
  'pom.xml': `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.demo</groupId>
  <artifactId>demo</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.2.4</version>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-data-jpa</artifactId>
      <version>3.2.4</version>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-security</artifactId>
      <version>3.2.4</version>
    </dependency>
    <dependency>
      <groupId>com.mysql</groupId>
      <artifactId>mysql-connector-j</artifactId>
      <version>8.3.0</version>
    </dependency>
  </dependencies>
</project>
`,
  'src/main/resources/application.yml': `spring:
  profiles:
    active: dev
  datasource:
    url: jdbc:mysql://localhost:3306/demo
    username: app
    password: supersecret
server:
  port: 8080
app:
  name: demo-service
`,
  'src/main/java/com/demo/App.java': `package com.demo;

public class App {
  public static void main(String[] args) {
  }
}
`,
  'src/main/java/com/demo/AuthFilter.java': `package com.demo;

public class AuthFilter implements Filter {
  public void doFilter() {
  }
}
`,
  'src/main/java/com/demo/OrdersController.java': `package com.demo;

@RestController
public class OrdersController {
  private final OrderService orderService = new OrderService();

  public String listOrders() {
    return orderService.findOrders();
  }

  public String getOrder(long id) {
    return orderService.findById(id);
  }
}
`,
  'src/main/java/com/demo/OrderService.java': `package com.demo;

@Service
public class OrderService {
  private final OrderRepository orderRepository = new OrderRepository();

  public String findOrders() {
    return orderRepository.findAll();
  }

  public String findById(long id) {
    return orderRepository.findById(id);
  }
}
`,
  'src/main/java/com/demo/OrderRepository.java': `package com.demo;

@Repository
public class OrderRepository {
  public String findAll() {
    return "orders";
  }

  public String findById(long id) {
    return "order-" + id;
  }
}
`,
  'src/main/java/com/demo/GlobalExceptionHandler.java': `package com.demo;

@RestControllerAdvice
public class GlobalExceptionHandler {
  public String handleIllegal(IllegalArgumentException ex) {
    return "bad";
  }
}
`
};

describe('onboardingExportFileName — safe download names', () => {
  it('builds the standard {repoName}-ONBOARDING.md name', () => {
    expect(onboardingExportFileName('petclinic')).toBe('petclinic-ONBOARDING.md');
    expect(onboardingExportFileName(undefined)).toBe('repo-ONBOARDING.md');
    expect(onboardingExportFileName('')).toBe('repo-ONBOARDING.md');
  });

  it('sanitizes illegal file-name characters', () => {
    expect(sanitizeFileName('a/b\\c:d')).toBe('a_b_c_d');
    expect(onboardingExportFileName('shop:admin/1')).toBe('shop_admin_1-ONBOARDING.md');
  });
});

describe('buildOnboardingMarkdown — full-featured Spring repo', () => {
  let markdown: string;

  beforeAll(async () => {
    markdown = buildOnboardingMarkdown({
      repoId: 'repo-1',
      repoName: 'shop',
      symbols: await parseTree(FULL_REPO),
      now: () => new Date('2026-08-21T00:00:00.000Z')
    });
  });

  it('renders the standard handover scaffolding', () => {
    expect(markdown).toContain('# shop — ONBOARDING 架构交接手册');
    expect(markdown).toContain('repoId: `repo-1`');
    expect(markdown).toContain('生成时间：2026-08-21T00:00:00.000Z');
    expect(markdown).toContain('## 技术栈（Tech Stack）');
    expect(markdown).toContain('## 架构指标（Architecture Scale）');
    expect(markdown).toContain('## 脱敏配置（Config Topology）');
    expect(markdown).toContain('## Top 核心 API（时序图）');
    expect(markdown).toContain('## Onboarding 路线（3 条）');
  });

  it('lists the tech stack categories with exact dependency keys', () => {
    expect(markdown).toContain('高亮：Spring Boot、Spring Security、Spring Data JPA、MySQL');
    expect(markdown).toContain('### Security（1）');
    expect(markdown).toContain('`org.springframework.boot:spring-boot-starter-security`');
    expect(markdown).toContain('### Database（1）');
    expect(markdown).toContain('`com.mysql:mysql-connector-j`');
    expect(markdown).toContain('### ORM（1）');
    expect(markdown).toContain('`org.springframework.boot:spring-boot-starter-data-jpa`');
    expect(markdown).toContain('### Framework（1）');
    expect(markdown).toContain('`org.springframework.boot:spring-boot-starter-web`');
  });

  it('renders the architecture-scale table with the fixture numbers', () => {
    expect(markdown).toContain('| Routes | 1 |');
    expect(markdown).toContain('| Services | 1 |');
    expect(markdown).toContain('| Repositories | 1 |');
    expect(markdown).toContain('| Advices | 1 |');
    expect(markdown).toContain('| Config keys | ');
  });

  it('masks config: only keys, values never appear', () => {
    expect(markdown).toContain('| datasource | `spring.datasource.password` |');
    expect(markdown).toContain('⚠ sensitive');
    expect(markdown).toContain('| server | `server.port` |');
    expect(markdown).toContain('| profile | `spring.profiles.active` |');
    expect(markdown).toContain('| other | `app.name` |');
    // Issue 06: values are never indexed — the document is value-free.
    expect(markdown).not.toContain('supersecret');
    expect(markdown).not.toContain('8080');
    expect(markdown).not.toContain('jdbc:mysql');
    expect(markdown).not.toContain('demo-service');
  });

  it('renders Top API entries with hop chains and Mermaid sequence diagrams', () => {
    expect(markdown).toContain('### listOrders');
    expect(markdown).toContain('控制器：`OrdersController`');
    expect(markdown).toContain('深度：3');
    expect(markdown).toContain('`listOrders → findOrders → findAll`');
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('sequenceDiagram');
    expect(markdown).toContain('participant p1 as listOrders');
    expect(markdown).toContain('participant p3 as findAll');
    expect(markdown).toContain('p1->>p2: 调用');
  });

  it('renders all three onboarding routes with steps and tour mermaid graphs', () => {
    expect(markdown).toContain('路线一：鉴权与拦截链（`auth-chain`）');
    expect(markdown).toContain('AuthFilter.doFilter（认证过滤器）');
    expect(markdown).toContain('路线二：核心主业务流（`main-flow`）');
    expect(markdown).toContain('listOrders（入口接口）');
    expect(markdown).toContain('findAll');
    expect(markdown).toContain('路线三：全局异常拦截（`error-handling`）');
    expect(markdown).toContain('GlobalExceptionHandler（全局异常入口）');
    expect(markdown).toContain('GlobalExceptionHandler.handleIllegal（异常处理器）');
    // Each tour embeds its own mermaid flowchart.
    expect(markdown.match(/```mermaid/g)).toHaveLength(5); // 2 sequence + 3 tour graphs
  });

  it('does not mangle markdown table/backtick structure', () => {
    // Every fenced block is closed.
    const fences = markdown.match(/^```/gm);
    expect(fences?.length).toBe(10);
    expect(fences?.length).toBe(markdown.match(/^```mermaid/gm)!.length * 2);
  });
});

describe('buildOnboardingMarkdown — degenerate repos', () => {
  it('produces a well-formed document for an empty symbol table', async () => {
    const markdown = buildOnboardingMarkdown({
      repoId: 'repo-empty',
      repoName: 'empty',
      symbols: [],
      now: () => new Date('2026-08-21T00:00:00.000Z')
    });
    expect(markdown).toContain('# empty — ONBOARDING 架构交接手册');
    expect(markdown).toContain('未检测到框架依赖。');
    expect(markdown).toContain('无配置键。');
    expect(markdown).toContain('未检测到 REST 入口。');
    expect(markdown).toContain('该路线暂无步骤。');
    expect(markdown).toMatch(/\n$/);
  });
});