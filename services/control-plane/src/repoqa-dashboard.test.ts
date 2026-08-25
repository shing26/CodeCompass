import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RepoSymbol } from './repoqa-repos';
import { parseJavaFile } from './repoqa-parser';
import { extractConfigSymbols } from './repoqa-config';
import {
  buildDashboard,
  classifyConfigKey,
  classifyDependency,
  isSensitiveConfigKey,
  type RepoDashboard
} from './repoqa-dashboard';

/** Parse java sources + config files (yml/properties/pom) into one symbol list. */
async function parseTree(files: Record<string, string>): Promise<RepoSymbol[]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-dashboard-'));
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

// —————————————————————————————————————————————————————————————————————
// Fixtures: a realistic Spring Boot-ish project (deps + config + layers),
// and a plain library repo with nothing to aggregate.
// —————————————————————————————————————————————————————————————————————
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
    <dependency>
      <groupId>com.h2database</groupId>
      <artifactId>h2</artifactId>
      <scope>runtime</scope>
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
  'src/main/java/com/demo/UserController.java': `package com.demo;

@RestController
public class UserController {
  private final UserService userService = new UserService();

  public String listUsers() {
    return userService.findAllUsers();
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
  'src/main/java/com/demo/UserService.java': `package com.demo;

@Service
public class UserService {
  public String findAllUsers() {
    return "users";
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

const LIB_REPO: Record<string, string> = {
  'src/main/java/com/lib/Calculator.java': `package com.lib;

public class Calculator {
  public int add(int a, int b) {
    return a + b;
  }
}
`
};

describe('classifyDependency — pom dependency taxonomy', () => {
  it.each([
    ['org.springframework.boot:spring-boot-starter-web', 'framework'],
    ['org.springframework.boot:spring-boot-starter-security', 'security'],
    ['org.springframework.boot:spring-boot-starter-data-jpa', 'orm'],
    ['org.mybatis.spring.boot:mybatis-spring-boot-starter', 'orm'],
    ['org.springframework.boot:spring-boot-starter-data-redis', 'cache'],
    ['org.springframework.boot:spring-boot-starter-actuator', 'observability'],
    ['org.junit.jupiter:junit-jupiter', 'test'],
    ['org.springframework.cloud:spring-cloud-starter-openfeign', 'http'],
    ['com.mysql:mysql-connector-j', 'database'],
    ['org.postgresql:postgresql', 'database'],
    ['com.h2database:h2 (runtime)', 'database'],
    ['org.mongodb:mongodb-driver-sync', 'database'],
    ['org.projectlombok:lombok', 'other']
  ] as Array<[string, ReturnType<typeof classifyDependency>]>)(
    'classifies %s as %s',
    (name, category) => {
      expect(classifyDependency(name)).toBe(category);
    }
  );
});

describe('config key classification', () => {
  it('splits keys into server / datasource / profile / other groups', () => {
    expect(classifyConfigKey('server.port')).toBe('server');
    expect(classifyConfigKey('server.servlet.context-path')).toBe('server');
    expect(classifyConfigKey('spring.datasource.url')).toBe('datasource');
    expect(classifyConfigKey('spring.datasource.username')).toBe('datasource');
    expect(classifyConfigKey('spring.profiles.active')).toBe('profile');
    expect(classifyConfigKey('app.name')).toBe('other');
  });

  it('flags credential keys as sensitive', () => {
    expect(isSensitiveConfigKey('spring.datasource.password')).toBe(true);
    expect(isSensitiveConfigKey('api-key')).toBe(true);
    expect(isSensitiveConfigKey('JWT_SECRET')).toBe(true);
    expect(isSensitiveConfigKey('server.port')).toBe(false);
    expect(isSensitiveConfigKey('app.name')).toBe(false);
  });
});

describe('buildDashboard — full-featured Spring repo', () => {
  let dashboard: RepoDashboard;

  beforeAll(async () => {
    dashboard = buildDashboard({
      repoId: 'repo-1',
      repoName: 'shop',
      symbols: await parseTree(FULL_REPO)
    });
  });

  it('aggregates tech stack categories in canonical order with exact items', () => {
    const summary = dashboard.techStack.summary;
    expect(summary.map((entry) => entry.category)).toEqual([
      'security',
      'database',
      'orm',
      'framework'
    ]);
    const security = summary.find((entry) => entry.category === 'security')!;
    expect(security.count).toBe(1);
    expect(security.items[0]).toMatchObject({
      name: 'org.springframework.boot:spring-boot-starter-security',
      category: 'security',
      filePath: 'pom.xml',
      lineStart: 19
    });
    const database = summary.find((entry) => entry.category === 'database')!;
    expect(database.count).toBe(2);
    expect(database.items.map((item) => item.name)).toEqual([
      'com.mysql:mysql-connector-j',
      'com.h2database:h2 (runtime)'
    ]);
    expect(dashboard.techStack.highlights).toEqual([
      'Spring Boot',
      'Spring Security',
      'Spring Data JPA',
      'MySQL',
      'H2'
    ]);
  });

  it('reports exact architecture scale counts', () => {
    expect(dashboard.scale).toEqual({
      routes: 2,
      services: 2,
      repositories: 1,
      advices: 1,
      plainClasses: 1,
      interfaces: 0,
      methods: 10,
      fields: 3,
      configKeys: 6,
      files: 9
    });
  });

  it('builds a value-free, masked config topology with groups', () => {
    expect(dashboard.config.maskedValues).toBe(true);
    const topology = dashboard.config.topology;
    const keys = topology.map((item) => item.key);
    for (const key of keys) {
      expect(keys.some((other) => other !== key && other.startsWith(`${key}.`))).toBe(false);
    }
    const serverPort = topology.find((item) => item.key === 'server.port')!;
    expect(serverPort).toMatchObject({
      filePath: 'src/main/resources/application.yml',
      lineStart: 9,
      group: 'server',
      sensitive: false
    });
    const dbPassword = topology.find((item) => item.key === 'spring.datasource.password')!;
    expect(dbPassword).toMatchObject({
      group: 'datasource',
      sensitive: true
    });
    const profile = topology.find((item) => item.key === 'spring.profiles.active')!;
    expect(profile).toMatchObject({ group: 'profile', sensitive: false });
    // No value ever appears in the dashboard payload — keys only.
    const serialized = JSON.stringify(dashboard);
    expect(serialized).not.toContain('supersecret');
    expect(serialized).not.toContain(':8080');
  });

  it('ranks top APIs by static call depth, ties by source order', () => {
    expect(dashboard.topApis).toEqual([
      {
        name: 'listOrders',
        controller: 'OrdersController',
        filePath: 'src/main/java/com/demo/OrdersController.java',
        lineStart: 7,
        depth: 3,
        hops: ['listOrders', 'findOrders', 'findAll']
      },
      {
        name: 'getOrder',
        controller: 'OrdersController',
        filePath: 'src/main/java/com/demo/OrdersController.java',
        lineStart: 11,
        depth: 3,
        hops: ['getOrder', 'findById', 'findById']
      },
      {
        name: 'listUsers',
        controller: 'UserController',
        filePath: 'src/main/java/com/demo/UserController.java',
        lineStart: 7,
        depth: 2,
        hops: ['listUsers', 'findAllUsers']
      }
    ]);
  });

  it('is deterministic across repeated builds', async () => {
    const symbols = await parseTree(FULL_REPO);
    const again = buildDashboard({ repoId: 'repo-1', repoName: 'shop', symbols });
    expect(again).toEqual(dashboard);
  });

  it('honors topLimit and maxDepth options', async () => {
    const symbols = await parseTree(FULL_REPO);
    const limited = buildDashboard({ repoId: 'repo-1', symbols, topLimit: 2 });
    expect(limited.topApis).toHaveLength(2);
    expect(limited.topApis[0].name).toBe('listOrders');

    const shallow = buildDashboard({ repoId: 'repo-1', symbols, maxDepth: 1 });
    expect(shallow.topApis[0].depth).toBe(2);
    expect(shallow.topApis[0].hops).toEqual(['listOrders', 'findOrders']);
  });

  it('keeps every top API entry internally consistent', () => {
    for (const api of dashboard.topApis) {
      expect(api.hops.length).toBe(api.depth);
      expect(api.hops[0]).toBe(api.name);
      expect(api.controller).toBeTruthy();
      expect(api.lineStart).toBeGreaterThan(0);
    }
  });
});

describe('buildDashboard — library repo with nothing to aggregate', () => {
  it('returns zeroed scale and a source-only tech stack without crashing', async () => {
    const dashboard = buildDashboard({
      repoId: 'repo-2',
      repoName: 'lib',
      symbols: await parseTree(LIB_REPO)
    });
    expect(dashboard.scale).toEqual({
      routes: 0,
      services: 0,
      repositories: 0,
      advices: 0,
      plainClasses: 1,
      interfaces: 0,
      methods: 1,
      fields: 0,
      configKeys: 0,
      files: 1
    });
    expect(dashboard.techStack.summary).toEqual([
      {
        category: 'other',
        label: 'Java (Source Only)',
        count: 1,
        items: [
          {
            category: 'other',
            name: 'Java (Source Only)',
            filePath: 'src/main/java/com/lib/Calculator.java',
            lineStart: 3
          }
        ]
      }
    ]);
    expect(dashboard.techStack.highlights).toEqual(['Java (Source Only)']);
    expect(dashboard.config.topology).toEqual([]);
    expect(dashboard.config.maskedValues).toBe(true);
    expect(dashboard.topApis).toEqual([]);
  });
});
