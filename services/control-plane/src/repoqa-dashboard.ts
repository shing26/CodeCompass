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
    classes: number;
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
  { category: 'security', label: 'Security', re: /security|shiro|\bjwt\b|jjwt/ },
  { category: 'database', label: 'Database', re: /mysql|postgres|mariadb|sqlserver|oracle|sqlite|h2|mongodb|mongo-driver|\bjdbc\b/ },
  { category: 'orm', label: 'ORM', re: /mybatis|data-jpa|spring-data|hibernate/ },
  { category: 'cache', label: 'Cache', re: /redis|caffeine|ehcache|hazelcast/ },
  { category: 'observability', label: 'Observability', re: /actuator|micrometer|prometheus|sleuth|zipkin|loki/ },
  { category: 'test', label: 'Test', re: /junit|mockito|assertj|testcontainers/ },
  { category: 'http', label: 'HTTP Client', re: /openfeign|\bfeign\b|resttemplate|webflux|okhttp|retrofit|httpclient/ },
  { category: 'framework', label: 'Framework', re: /spring-boot|spring-cloud|^org\.springframework:|jakarta|^javax\.|quarkus|micronaut|vertx/ },
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

/** Methods declared inside @RestController classes, sorted by source location. */
function routeMethods(symbols: RepoSymbol[]): RepoSymbol[] {
  const routeNames = new Set(routeClasses(symbols).map((symbol) => symbol.name));
  return symbols
    .filter(
      (symbol) => symbol.kind === 'method' && symbol.parentType && routeNames.has(symbol.parentType)
    )
    .sort(byLocation);
}

function resolvedDepth(trace: RepoQaTraceHop[]): number {
  return trace.filter((hop) => !hop.break).length;
}

/** Top @RestController endpoints ranked by static call-chain depth, ties by source order. */
export function pickTopApis(
  symbols: RepoSymbol[],
  maxDepth: number,
  topLimit: number
): TopApiEntry[] {
  const limit = Math.max(1, Math.min(topLimit, 100));
  const entries: TopApiEntry[] = [];
  for (const method of routeMethods(symbols)) {
    const trace = resolveCallChain(symbols, method, maxDepth);
    entries.push({
      name: method.name,
      controller: method.parentType ?? '',
      filePath: method.filePath,
      lineStart: method.lineStart ?? 0,
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

function buildTechStack(symbols: RepoSymbol[]): RepoDashboard['techStack'] {
  const items: TechStackItem[] = symbols
    .filter((symbol) => symbol.kind === 'config' && symbol.name.includes(':'))
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
  return { summary, highlights: highlightLabels(items) };
}

function buildConfigTopology(symbols: RepoSymbol[]): ConfigTopologyItem[] {
  return symbols
    .filter((symbol) => symbol.kind === 'config' && !symbol.name.includes(':'))
    .sort((a, b) =>
      byLocation(a, b) !== 0 ? byLocation(a, b) : a.name.localeCompare(b.name)
    )
    .map((symbol) => ({
      key: symbol.name,
      filePath: symbol.filePath,
      lineStart: symbol.lineStart,
      group: classifyConfigKey(symbol.name),
      sensitive: isSensitiveConfigKey(symbol.name)
    }));
}

function buildScale(symbols: RepoSymbol[]): RepoDashboard['scale'] {
  const count = (kind: RepoSymbol['kind']) => symbols.filter((s) => s.kind === kind).length;
  return {
    routes: count('route'),
    services: count('service'),
    repositories: count('repository'),
    advices: count('advice'),
    classes: count('class'),
    interfaces: count('interface'),
    methods: count('method'),
    fields: count('field'),
    configKeys: count('config'),
    files: new Set(symbols.map((s) => s.filePath)).size
  };
}

export function buildDashboard(options: BuildDashboardOptions): RepoDashboard {
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 5, 20));
  const topLimit = options.topLimit ?? 10;
  return {
    repoId: options.repoId,
    repoName: options.repoName,
    techStack: buildTechStack(options.symbols),
    config: { topology: buildConfigTopology(options.symbols), maskedValues: true },
    scale: buildScale(options.symbols),
    topApis: pickTopApis(options.symbols, maxDepth, topLimit)
  };
}