import type { RepoSymbol } from './repoqa-repos';
import type { RepoQaTraceHop } from '../../../packages/contracts/src/index';
import { resolveCallChain } from './repoqa-callchain';

/**
 * Issue 12 — 零 Prompt 驾驶舱数据聚合（repo dashboard）。
 *
 * 全部基于已索引的符号表做确定性聚合，不依赖 LLM、不重新读源码：
 * 1. 技术栈与核心依赖：pom.xml 依赖 key（`groupId:artifactId`）按类别归类；
 * 2. 核心配置拓扑：application*.yml/.properties 的扁平 key 路径按 端口/数据源/
 *    Profile 分组。Issue 06 起配置只索引 key、从不落盘 value，因此看板输出的
 *    拓扑天然“已脱敏”——敏感 key（password/secret/token…）仅标记 sensitive。
 * 3. 架构规模指标：Routes/Services/Repositories/Advice 等按 kind 计数。
 * 4. Top 核心 API 入口：所有 @RestController 方法按静态调用链深度降序取前 N，
 *    同深度按文件→行号→名字字典序（与 Issue 05/11 的平局规则一致）。
 */

export type TechCategory =
  | 'framework'
  | 'security'
  | 'database'
  | 'orm'
  | 'cache'
  | 'observability'
  | 'test'
  | 'http'
  | 'other';

export type ConfigGroup = 'server' | 'datasource' | 'profile' | 'other';

export interface TechStackItem {
  name: string;
  category: TechCategory;
  filePath: string;
  lineStart?: number;
}

export interface ConfigTopologyItem {
  key: string;
  filePath: string;
  lineStart?: number;
  group: ConfigGroup;
  /** True when the key is a credential key — its value is never indexed nor shown. */
  sensitive: boolean;
}

export interface TopApiEntry {
  name: string;
  controller: string;
  filePath: string;
  lineStart: number;
  /** Number of statically resolved hops (including the entry method itself). */
  depth: number;
  /** Method names along the resolved chain, e.g. ['listOrders', 'findOrders', 'findAll']. */
  hops: string[];
}

export interface RepoDashboard {
  repoId: string;
  repoName?: string;
  techStack: {
    /** One entry per detected category, in canonical category order. */
    summary: Array<{ category: TechCategory; label: string; count: number; items: TechStackItem[] }>;
    /** Canonical framework labels, e.g. ['Spring Boot', 'Spring Security']. */
    highlights: string[];
  };
  config: {
    topology: ConfigTopologyItem[];
    /** Values are never indexed by design (Issue 06), so nothing sensitive is present. */
    maskedValues: true;
  };
  scale: {
    routes: number;
    services: number;
    repositories: number;
    advices: number;
    plainClasses: number;
    interfaces: number;
    methods: number;
    fields: number;
    configKeys: number;
    /** Distinct file paths that contributed symbols. */
    files: number;
  };
  topApis: TopApiEntry[];
}

export interface BuildDashboardOptions {
  repoId: string;
  repoName?: string;
  symbols: RepoSymbol[];
  /** Max hops for each API call chain (default 5). */
  maxDepth?: number;
  /** How many top APIs to return (default 10, clamped to [1, 100]). */
  topLimit?: number;
}

/* ------------------------------------------------------------------ */
/* Dependency classification (pom `groupId:artifactId` keys)           */
/* ------------------------------------------------------------------ */

const CATEGORY_RULES: Array<{ category: TechCategory; label: string; re: RegExp }> = [
  // Order matters: security before framework (starter-security contains spring-boot),
  // orm/database/cache before framework (spring-data-* / starter-data-*).
  { category: 'security', label: 'Security', re: /security|shiro|\bjwt\b|jjwt|oauth|helmet|passport|authlib/ },
  { category: 'database', label: 'Database', re: /mysql|postgres|mariadb|sqlserver|oracle|sqlite|h2|mongodb|mongo-driver|psycopg|pymysql|aiomysql|asyncpg|pymongo|\bmotor\b|\bjdbc\b/ },
  { category: 'orm', label: 'ORM', re: /mybatis|data-jpa|spring-data|hibernate|sqlalchemy|sqlmodel|typeorm|prisma|sequelize/ },
  { category: 'cache', label: 'Cache', re: /redis|caffeine|ehcache|hazelcast/ },
  { category: 'observability', label: 'Observability', re: /actuator|micrometer|prometheus|sleuth|zipkin|loki|opentelemetry|sentry|winston|pino|loguru/ },
  { category: 'test', label: 'Test', re: /junit|mockito|assertj|testcontainers|pytest|jest|vitest|playwright|mocha|cypress|supertest/ },
  { category: 'http', label: 'HTTP Client', re: /openfeign|\bfeign\b|resttemplate|webflux|okhttp|retrofit|httpclient|axios|httpx|requests|urllib3|aiohttp/ },
  { category: 'framework', label: 'Framework', re: /react|vue|angular|svelte|express|fastify|@nestjs|next|nuxt|vite|fastapi|flask|django|starlette|uvicorn|pydantic|tornado|gunicorn|spring-boot|spring-cloud|^org\.springframework:|jakarta|^javax\.|quarkus|micronaut|vertx/ },
  { category: 'other', label: 'Other', re: /./
  }
];

export const TECH_CATEGORY_ORDER: TechCategory[] = CATEGORY_RULES.map(
  (rule) => rule.category
);

export function classifyDependency(name: string): TechCategory {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(name)) return rule.category;
  }
  return 'other';
}

const HIGHLIGHT_KEYWORDS: Record<TechCategory, Array<{ re: RegExp; label: string }>> = {
  framework: [
    { re: /react/, label: 'React' },
    { re: /vue/, label: 'Vue' },
    { re: /express/, label: 'Express' },
    { re: /@nestjs/, label: 'NestJS' },
    { re: /^next$|^next\//, label: 'Next.js' },
    { re: /vite/, label: 'Vite' },
    { re: /fastapi/, label: 'FastAPI' },
    { re: /flask/, label: 'Flask' },
    { re: /django/, label: 'Django' },
    { re: /pydantic/, label: 'Pydantic' },
    { re: /spring-boot/, label: 'Spring Boot' },
    { re: /spring-cloud/, label: 'Spring Cloud' },
    { re: /^org\.springframework:/, label: 'Spring Framework' },
    { re: /quarkus/, label: 'Quarkus' },
    { re: /jakarta/, label: 'Jakarta EE' }
  ],
  security: [
    { re: /spring.*security|security.*spring/i, label: 'Spring Security' },
    { re: /shiro/, label: 'Apache Shiro' },
    { re: /\bjwt\b|jjwt|java-jwt/, label: 'JWT' }
  ],
  orm: [
    { re: /sqlalchemy/, label: 'SQLAlchemy' },
    { re: /typeorm/, label: 'TypeORM' },
    { re: /prisma/, label: 'Prisma' },
    { re: /mybatis/, label: 'MyBatis' },
    { re: /data-jpa|\bspring-data\b/, label: 'Spring Data JPA' },
    { re: /hibernate/, label: 'Hibernate' }
  ],
  database: [
    { re: /mysql/, label: 'MySQL' },
    { re: /postgres/, label: 'PostgreSQL' },
    { re: /mariadb/, label: 'MariaDB' },
    { re: /mongodb|mongo/, label: 'MongoDB' },
    { re: /h2/, label: 'H2' },
    { re: /sqlite/, label: 'SQLite' },
    { re: /sqlserver/, label: 'SQL Server' }
  ],
  cache: [
    { re: /redis/, label: 'Redis' },
    { re: /caffeine/, label: 'Caffeine' },
    { re: /ehcache/, label: 'Ehcache' }
  ],
  observability: [
    { re: /micrometer/, label: 'Micrometer' },
    { re: /prometheus/, label: 'Prometheus' },
    { re: /actuator/, label: 'Spring Boot Actuator' }
  ],
  test: [
    { re: /junit/, label: 'JUnit' },
    { re: /mockito/, label: 'Mockito' },
    { re: /testcontainers/, label: 'Testcontainers' }
  ],
  http: [
    { re: /axios/, label: 'Axios' },
    { re: /httpx/, label: 'HTTPX' },
    { re: /openfeign|\bfeign\b/, label: 'OpenFeign' },
    { re: /webflux/, label: 'WebFlux' },
    { re: /okhttp/, label: 'OkHttp' },
    { re: /retrofit/, label: 'Retrofit' }
  ],
  other: []
};

/** Highlight discovery order — framework first so the headline labels lead. */
const HIGHLIGHT_ORDER: TechCategory[] = [
  'framework',
  'security',
  'orm',
  'database',
  'cache',
  'observability',
  'test',
  'http',
  'other'
];

function highlightLabels(items: TechStackItem[]): string[] {
  const labels: string[] = [];
  for (const category of HIGHLIGHT_ORDER) {
    for (const keyword of HIGHLIGHT_KEYWORDS[category]) {
      if (labels.includes(keyword.label)) continue;
      if (items.some((item) => item.category === category && keyword.re.test(item.name))) {
        labels.push(keyword.label);
      }
    }
  }
  return labels;
}

/* ------------------------------------------------------------------ */
/* Config key classification (application*.yml / *.properties keys)    */
/* ------------------------------------------------------------------ */

const SENSITIVE_KEY_RE =
  /password|passwd|secret|token|credential|api[-_.]?key|access[-_.]?key|private[-_.]?key|authorization/i;

export function isSensitiveConfigKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

export function classifyConfigKey(key: string): ConfigGroup {
  const lower = key.toLowerCase();
  if (/profile|environment/.test(lower)) return 'profile';
  if (/datasource|database|jdbc/.test(lower)) return 'datasource';
  if (/server\.|(^|\.)port($|\.)/.test(lower)) return 'server';
  return 'other';
}

/* ------------------------------------------------------------------ */
/* Aggregation helpers                                                 */
/* ------------------------------------------------------------------ */

function byLocation(a: RepoSymbol, b: RepoSymbol): number {
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  const lineDiff = (a.lineStart ?? 0) - (b.lineStart ?? 0);
  if (lineDiff !== 0) return lineDiff;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function routeClasses(symbols: RepoSymbol[]): RepoSymbol[] {
  return symbols.filter((symbol) => symbol.kind === 'route').sort(byLocation);
}

/**
 * v0.5.1 (D5) — API entry candidates across languages: standalone route
 * symbols with handler edges (Express / FastAPI / Flask) plus methods declared
 * inside route classes (Spring / NestJS). Deduplicated by source location.
 */
function apiEntryCandidates(symbols: RepoSymbol[]): RepoSymbol[] {
  const routeNames = new Set(routeClasses(symbols).map((symbol) => symbol.name));
  const standalone = symbols.filter(
    (symbol) =>
      symbol.kind === 'route' &&
      ((symbol.calls?.length ?? 0) > 0 ||
        (/\.(ts|tsx|js|jsx|mjs)$/i.test(symbol.filePath) &&
          /^(GET|POST|PUT|DELETE|PATCH|ALL|USE)\s+/.test(symbol.name)))
  );
  const methods = symbols.filter(
    (symbol) =>
      symbol.kind === 'method' && symbol.parentType && routeNames.has(symbol.parentType)
  );
  const seen = new Set<string>();
  const out: RepoSymbol[] = [];
  for (const symbol of [...standalone, ...methods]) {
    const id = `${symbol.filePath}:${symbol.lineStart ?? 0}:${symbol.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(symbol);
  }
  return out.sort(byLocation);
}

function resolvedDepth(trace: RepoQaTraceHop[]): number {
  return trace.filter((hop) => !hop.break).length;
}

/** Top API endpoints ranked by static call-chain depth, ties by source order. */
export function pickTopApis(
  symbols: RepoSymbol[],
  maxDepth: number,
  topLimit: number
): TopApiEntry[] {
  const limit = Math.max(1, Math.min(topLimit, 100));
  const entries: TopApiEntry[] = [];
  for (const candidate of apiEntryCandidates(symbols)) {
    const trace = resolveCallChain(symbols, candidate, maxDepth);
    entries.push({
      name: candidate.name,
      controller: candidate.parentType ?? '',
      filePath: candidate.filePath,
      lineStart: candidate.lineStart ?? 0,
      depth: resolvedDepth(trace),
      hops: trace.map((hop) => hop.method)
    });
  }
  entries.sort((a, b) => {
    if (b.depth !== a.depth) return b.depth - a.depth;
    if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
    if (a.lineStart !== b.lineStart) return a.lineStart - b.lineStart;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return entries.slice(0, limit);
}

function sourceOnlyLabel(symbols: RepoSymbol[]): string | undefined {
  if (symbols.some((symbol) => symbol.filePath.endsWith('.java'))) return 'Java';
  if (symbols.some((symbol) => /\.(ts|tsx|js|jsx|mjs)$/.test(symbol.filePath))) {
    return 'TypeScript';
  }
  if (symbols.some((symbol) => symbol.filePath.endsWith('.py'))) return 'Python';
  if (symbols.some((symbol) => symbol.filePath.endsWith('.go'))) return 'Go';
  return undefined;
}

function buildTechStack(symbols: RepoSymbol[]): RepoDashboard['techStack'] {
  const items: TechStackItem[] = symbols
    .filter((symbol) => symbol.kind === 'dependency')
    .sort(byLocation)
    .map((symbol) => ({
      name: symbol.name,
      category: classifyDependency(symbol.name),
      filePath: symbol.filePath,
      lineStart: symbol.lineStart
    }));
  const summary: RepoDashboard['techStack']['summary'] = [];
  for (const category of TECH_CATEGORY_ORDER) {
    const grouped = items.filter((item) => item.category === category);
    if (grouped.length === 0) continue;
    const label = CATEGORY_RULES.find((rule) => rule.category === category)!.label;
    summary.push({ category, label, count: grouped.length, items: grouped });
  }
  const sourceLabel = sourceOnlyLabel(symbols);
  if (summary.length === 0 && sourceLabel) {
    const firstSource = symbols.find((symbol) =>
      sourceLabel === 'Java'
        ? symbol.filePath.endsWith('.java')
        : sourceLabel === 'TypeScript'
          ? /\.(ts|tsx|js|jsx|mjs)$/.test(symbol.filePath)
          : sourceLabel === 'Python'
            ? symbol.filePath.endsWith('.py')
            : symbol.filePath.endsWith('.go')
    )!;
    const label = `${sourceLabel} (Source Only)`;
    summary.push({
      category: 'other',
      label,
      count: 1,
      items: [
        {
          name: label,
          category: 'other',
          filePath: firstSource.filePath,
          lineStart: firstSource.lineStart
        }
      ]
    });
    return { summary, highlights: [label] };
  }
  return { summary, highlights: highlightLabels(items) };
}

function buildConfigTopology(symbols: RepoSymbol[]): ConfigTopologyItem[] {
  const configSymbols = symbols
    .filter((symbol) => symbol.kind === 'config' && !symbol.name.includes(':'))
    .sort((a, b) =>
      byLocation(a, b) !== 0 ? byLocation(a, b) : a.name.localeCompare(b.name)
    );
  const allKeys = configSymbols.map((symbol) => symbol.name);
  const visible = configSymbols.filter(
    (symbol) => !allKeys.some((other) => other !== symbol.name && other.startsWith(`${symbol.name}.`))
  );
  return visible.map((symbol) => ({
      key: symbol.name,
      filePath: symbol.filePath,
      lineStart: symbol.lineStart,
      group: classifyConfigKey(symbol.name),
      sensitive: isSensitiveConfigKey(symbol.name)
  }));
}

function buildScale(symbols: RepoSymbol[], configKeys?: number): RepoDashboard['scale'] {
  const count = (kind: RepoSymbol['kind']) => symbols.filter((s) => s.kind === kind).length;
  return {
    routes: count('route'),
    services: count('service'),
    repositories: count('repository'),
    advices: count('advice'),
    plainClasses: count('class'),
    interfaces: count('interface'),
    methods: count('method'),
    fields: count('field'),
    configKeys: configKeys ?? count('config'),
    files: new Set(symbols.map((s) => s.filePath)).size
  };
}

export function buildDashboard(options: BuildDashboardOptions): RepoDashboard {
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 5, 20));
  const topLimit = options.topLimit ?? 10;
  const configTopology = buildConfigTopology(options.symbols);
  return {
    repoId: options.repoId,
    repoName: options.repoName,
    techStack: buildTechStack(options.symbols),
    config: { topology: configTopology, maskedValues: true },
    scale: buildScale(options.symbols, configTopology.length),
    topApis: pickTopApis(options.symbols, maxDepth, topLimit)
  };
}
