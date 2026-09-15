import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoSymbol } from './repoqa-repos';
import {
  extractConfigSymbols,
  matchConfigSymbols,
  scanAppSettingsJson,
  scanEnv,
  scanPackageJson,
  scanPipfile,
  scanPyprojectToml,
  scanPythonSourceConfig,
  scanPom,
  scanProperties,
  scanRequirements,
  scanTypeScriptConfig,
  scanYaml
} from './repoqa-config';

function config(name: string, file: string, line: number): RepoSymbol {
  return { repoId: 'r', kind: 'config', name, filePath: file, lineStart: line };
}

describe('scanYaml — deterministic flattened keys with line numbers', () => {
  const source = [
    'server:',
    '  port: 8080',
    'spring:',
    '  datasource:',
    '    url: jdbc:mysql://localhost/demo',
    '    password: secret',
    '# comment line',
    'logging.level.root: info'
  ].join('\n');

  it('flattens nested mappings into dot-paths and records the mapping line', () => {
    expect(scanYaml(source)).toEqual([
      { name: 'server.port', lineStart: 2 },
      { name: 'spring.datasource.url', lineStart: 5 },
      { name: 'spring.datasource.password', lineStart: 6 },
      { name: 'logging.level.root', lineStart: 8 }
    ]);
  });

  it('never exposes plaintext values in the scanned keys', () => {
    const names = scanYaml(source).map((key) => key.name);
    expect(names.some((name) => /8080|jdbc|secret/.test(name))).toBe(false);
  });

  it('handles 4-space indentation and skips list members', () => {
    expect(
      scanYaml('a:\n    b: 1\n  - c: 2\n    d: 3')
    ).toEqual([
      { name: 'a.b', lineStart: 2 },
      { name: 'a.d', lineStart: 4 }
    ]);
  });
});

describe('scanProperties — key side only, with line numbers', () => {
  it('parses = and : forms, skips comments, allows spaces around the separator', () => {
    expect(
      scanProperties(
        'server.port=8080\n# comment\nspring.datasource.password = secret\napp.name: demo\n'
      )
    ).toEqual([
      { name: 'server.port', lineStart: 1 },
      { name: 'spring.datasource.password', lineStart: 3 },
      { name: 'app.name', lineStart: 4 }
    ]);
  });
});

describe('scanPom — dependency component keys', () => {
  const pom = [
    '<project>',
    '  <modelVersion>4.0.0</modelVersion>',
    '  <groupId>com.demo</groupId>',
    '  <artifactId>demo</artifactId>',
    '  <version>1.0.0</version>',
    '  <dependencies>',
    '    <dependency>',
    '      <groupId>org.springframework.boot</groupId>',
    '      <artifactId>spring-boot-starter-web</artifactId>',
    '      <version>3.2.4</version>',
    '    </dependency>',
    '    <dependency>',
    '      <groupId>com.mysql</groupId>',
    '      <artifactId>mysql-connector-j</artifactId>',
    '      <version>8.3.0</version>',
    '      <scope>runtime</scope>',
    '    </dependency>',
    '  </dependencies>',
    '</project>'
  ].join('\n');

  it('records groupId:artifactId keys at the artifactId line through the closing tag', () => {
    expect(scanPom(pom)).toEqual([
      {
        name: 'org.springframework.boot:spring-boot-starter-web',
        lineStart: 9,
        lineEnd: 11
      },
      {
        name: 'com.mysql:mysql-connector-j (runtime)',
        lineStart: 14,
        lineEnd: 17
      }
    ]);
  });

  it('ignores project coordinates (not dependencies) and empty poms', () => {
    expect(scanPom('<project>\n  <artifactId>demo</artifactId>\n</project>\n')).toEqual([]);
    expect(scanPom('')).toEqual([]);
  });
});

describe('extractConfigSymbols — repo wiring', () => {
  it('scans application*.yml/properties and pom.xml into relative-path symbols', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-config-'));
    try {
      await fs.mkdir(path.join(root, 'src', 'main', 'resources'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'src', 'main', 'resources', 'application.yml'),
        'server:\n  port: 8080\n'
      );
      await fs.writeFile(
        path.join(root, 'src', 'main', 'resources', 'application-prod.yaml'),
        'app:\n  name: prod\n'
      );
      await fs.writeFile(
        path.join(root, 'src', 'main', 'resources', 'application.properties'),
        'spring.datasource.url=jdbc:h2:mem\n'
      );
      await fs.writeFile(
        path.join(root, 'pom.xml'),
        '<project>\n  <dependencies>\n    <dependency>\n      <groupId>com.demo</groupId>\n      <artifactId>lib</artifactId>\n    </dependency>\n  </dependencies>\n</project>\n'
      );
      await fs.writeFile(path.join(root, 'README.md'), '# Demo\n');

      const files = [
        path.join(root, 'src', 'main', 'resources', 'application.yml'),
        path.join(root, 'src', 'main', 'resources', 'application-prod.yaml'),
        path.join(root, 'src', 'main', 'resources', 'application.properties'),
        path.join(root, 'pom.xml'),
        path.join(root, 'README.md')
      ];
      const symbols = await extractConfigSymbols('r', root, files);
      const byName = (name: string) => symbols.find((symbol) => symbol.name === name);

      expect(symbols.filter((symbol) => symbol.kind === 'config').length).toBe(3);
      expect(symbols.filter((symbol) => symbol.kind === 'dependency').length).toBe(1);
      expect(byName('server.port')).toMatchObject({
        filePath: 'src/main/resources/application.yml',
        lineStart: 2
      });
      expect(byName('app.name')).toMatchObject({
        filePath: 'src/main/resources/application-prod.yaml',
        lineStart: 2
      });
      expect(byName('spring.datasource.url')).toMatchObject({
        filePath: 'src/main/resources/application.properties',
        lineStart: 1
      });
      expect(byName('com.demo:lib')).toMatchObject({
        kind: 'dependency',
        filePath: 'pom.xml',
        lineStart: 5
      });
      expect(symbols.some((symbol) => symbol.filePath === 'README.md')).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('v0.5.1 — polyglot dependency and config key scanners', () => {
  it('scans package.json dependency names with line numbers', () => {
    const source = [
      '{',
      '  "name": "demo",',
      '  "dependencies": {',
      '    "express": "^4.18.0",',
      '    "react": "^18.0.0"',
      '  },',
      '  "devDependencies": {',
      '    "vite": "^5.0.0"',
      '  }',
      '}'
    ].join('\n');
    expect(scanPackageJson(source)).toEqual([
      { name: 'express', lineStart: 4 },
      { name: 'react', lineStart: 5 },
      { name: 'vite', lineStart: 8 }
    ]);
  });

  it('scans pyproject.toml, requirements.txt and Pipfile dependencies', () => {
    const pyproject = [
      '[project]',
      'name = "demo"',
      'dependencies = [',
      '  "fastapi>=0.115.0",',
      '  "pydantic-settings>=2.0.0"',
      ']',
      '',
      '[project.optional-dependencies]',
      'dev = ["pytest>=8.0.0"]',
      '',
      '[tool.poetry.dependencies]',
      'requests = "^2.31.0"'
    ].join('\n');
    expect(scanPyprojectToml(pyproject).map((key) => key.name)).toEqual([
      'fastapi',
      'pydantic-settings',
      'pytest',
      'requests'
    ]);

    expect(scanRequirements('fastapi>=0.111\npytest[asyncio]>=8.0\n# comment\n')).toEqual([
      { name: 'fastapi', lineStart: 1 },
      { name: 'pytest', lineStart: 2 }
    ]);
    expect(scanPipfile('[packages]\nfastapi = ">=0.111"\n[dev-packages]\npytest = "*"\n')).toEqual([
      { name: 'fastapi', lineStart: 2 },
      { name: 'pytest', lineStart: 4 }
    ]);
  });

  it('scans .env, settings.py, config.ts and appsettings.json keys without values', () => {
    expect(scanEnv('OPENAI_API_KEY=sk-secret\nPORT=8080\n# comment\n')).toEqual([
      { name: 'OPENAI_API_KEY', lineStart: 1 },
      { name: 'PORT', lineStart: 2 }
    ]);
    expect(scanPythonSourceConfig('DEBUG = True\nDATABASE_URL = "postgres://x"\n')).toEqual([
      { name: 'DEBUG', lineStart: 1 },
      { name: 'DATABASE_URL', lineStart: 2 }
    ]);
    expect(scanTypeScriptConfig('export const PORT = 8080;\nconst NODE_ENV = "dev";\n')).toEqual([
      { name: 'PORT', lineStart: 1 },
      { name: 'NODE_ENV', lineStart: 2 }
    ]);
    expect(scanAppSettingsJson('{\n  "Logging": {},\n  "ConnectionStrings": {}\n}\n')).toEqual([
      { name: 'Logging', lineStart: 2 },
      { name: 'ConnectionStrings', lineStart: 3 }
    ]);
  });

  it('v0.18 config scanners keep UPPER_SNAKE only — lowercase state stays out of the topology', () => {
    // Python: lowercase module state (content/temporary_path style) is noise.
    expect(
      scanPythonSourceConfig(
        'content = req.json\ntemporary_path = tempfile.mkdtemp()\nDEBUG = True\n_DB_URL = "x"\n'
      )
    ).toEqual([{ name: 'DEBUG', lineStart: 3 }]);
    // TypeScript: camelCase/lowercase consts are not configuration keys.
    expect(
      scanTypeScriptConfig('export const app = express()\nconst defaultPort = 8080\nexport const API_BASE = "/api"\n')
    ).toEqual([{ name: 'API_BASE', lineStart: 3 }]);
  });

  it('extracts dependency symbols from package.json and pyproject.toml', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-poly-config-'));
    try {
      await fs.writeFile(
        path.join(root, 'package.json'),
        '{\n  "dependencies": { "express": "^4.18.0" }\n}\n'
      );
      await fs.writeFile(
        path.join(root, 'pyproject.toml'),
        '[project]\ndependencies = ["fastapi>=0.111"]\n'
      );
      const files = [
        path.join(root, 'package.json'),
        path.join(root, 'pyproject.toml')
      ];
      const symbols = await extractConfigSymbols('r', root, files);
      expect(symbols.map((symbol) => symbol.kind)).toEqual(['dependency', 'dependency']);
      expect(symbols.map((symbol) => symbol.name)).toEqual(['express', 'fastapi']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('matchConfigSymbols — deterministic environment intent', () => {
  const configs = [
    config('server.port', 'src/main/resources/application.properties', 1),
    config('spring.datasource.password', 'src/main/resources/application.yml', 6),
    config('spring.datasource.url', 'src/main/resources/application.yml', 5),
    config('org.springframework.boot:spring-boot-starter-web', 'pom.xml', 9),
    config('com.mysql:mysql-connector-j (runtime)', 'pom.xml', 14)
  ];

  it('filters by english key words', () => {
    expect(matchConfigSymbols('port', configs).map((c) => c.name)).toEqual(['server.port']);
    expect(matchConfigSymbols('password config', configs).map((c) => c.name)).toEqual([
      'spring.datasource.password'
    ]);
  });

  it('maps Chinese intent categories to key terms', () => {
    expect(matchConfigSymbols('数据库连接配置', configs).map((c) => c.name)).toEqual([
      'spring.datasource.password',
      'spring.datasource.url'
    ]);
    expect(matchConfigSymbols('端口', configs).map((c) => c.name)).toEqual(['server.port']);
    expect(matchConfigSymbols('依赖组件', configs).map((c) => c.name)).toEqual([
      'org.springframework.boot:spring-boot-starter-web',
      'com.mysql:mysql-connector-j (runtime)'
    ]);
    expect(matchConfigSymbols('密码是什么', configs).map((c) => c.name)).toEqual([
      'spring.datasource.password'
    ]);
  });

  it('falls back to all config keys when no intent matches', () => {
    expect(matchConfigSymbols('configuration', configs).map((c) => c.name)).toEqual(
      configs.map((c) => c.name)
    );
  });
});
