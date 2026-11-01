import { z } from 'zod';

/**
 * 票 05(mcp-structured-output)— outputSchema for every MCP tool.
 *
 * The SDK hard-validates successful results against the declared outputSchema
 * (server/mcp.js:186-209 throws McpError InvalidParams on missing/mismatched
 * structuredContent; isError results are exempt). So every shape below must
 * match the handler payloads exactly as surveyed on 2026-11-02:
 * - fields dropped as `undefined` by JSON.stringify are `.optional()`;
 * - fields carrying null (trace hops) are `.nullable()`;
 * - plain z.object (never .strict()) — additive fields (the verification
 *   receipt, future increments) must keep validating.
 * The `verification` receipt is unconditionally appended to every object
 * payload (withVerificationReceipt), so it is REQUIRED in all 16 object shapes;
 * trace_call_chain returns a bare array and is the only tool without it.
 * Its structured channel is wrapped as { items: [...] } — MCP requires an
 * object there; the text channel keeps the bare array, byte-for-byte.
 */

/** output-contract.ts VerificationReceipt — v1.5 定名的对外契约。 */
const verificationReceipt = z.object({
  engineVersion: z.string(),
  tool: z.string(),
  verdict: z.enum(['VERIFIED', 'ANCHORS_MISSING', 'UNCHECKED', 'NO_EVIDENCE']),
  anchorsTotal: z.number(),
  anchorsChecked: z.number(),
  anchorsMissing: z.array(
    z.object({ path: z.string(), file: z.string(), line: z.number().nullable() })
  ),
  breakMarkers: z.record(z.number()),
  diagnostics: z.array(
    z.object({
      path: z.string(),
      code: z.enum([
        'ANCHOR_FILE_MISSING',
        'ANCHOR_LINE_OUT_OF_RANGE',
        'ANCHOR_FIELD_INVALID',
        'ANCHORS_UNCHECKED',
        'ANCHORS_TRUNCATED'
      ]),
      message: z.string()
    })
  )
});

/* packages/contracts/src/repoqa.ts — ConventionAnchor / ConventionAxis / ConventionProfile */
const conventionAnchor = z.object({ file: z.string(), line: z.number(), symbol: z.string() });
const conventionCoverage = z.object({ match: z.number(), total: z.number() });
const conventionAxis = z.object({
  axis: z.enum(['return_wrapping', 'interface_impl_style', 'base_class', 'di_style', 'package_layout']),
  supported: z.boolean(),
  verdict: z.string().optional(),
  primary: z.string().optional(),
  coverage: conventionCoverage.optional(),
  anchors: z.array(conventionAnchor).optional(),
  dissidents: z.array(conventionAnchor).optional(),
  globalVerdict: z.object({ verdict: z.string(), coverage: conventionCoverage }).optional()
});
const conventionProfileShape = {
  repoId: z.string(),
  neighborPackage: z.string().optional(),
  axes: z.array(conventionAxis),
  sampledAt: z.string()
};
const conventionProfile = z.object(conventionProfileShape);

/* packages/contracts/src/repoqa.ts — ExtractedSymbol / CallEdge（architectureDelta 用） */
const extractedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  lineStart: z.number(),
  lineEnd: z.number(),
  kind: z.string(),
  parentType: z.string().optional(),
  displayPath: z.string().optional()
});
const callEdge = z.object({
  from: z.object({ file: z.string(), method: z.string(), line: z.number() }),
  to: z.object({ file: z.string(), method: z.string(), line: z.number() })
});

/* repoqa-mcp.ts mcpListRepos */
const listRepos = {
  repos: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['idle', 'indexing', 'ready', 'error']),
      fileCount: z.number(),
      symbolCount: z.number(),
      localPath: z.string(),
      error: z.string().optional()
    })
  ),
  verification: verificationReceipt
};

/* repoqa-mcp.ts mcpTraceCallChain — structured channel wraps the hop array. */
const traceCallChain = {
  items: z.array(
    z.object({
      file: z.string(),
      method: z.string(),
      line: z.number().nullable(),
      lineEnd: z.number().nullable(),
      callLine: z.number().nullable(),
      break: z.boolean(),
      reason: z.string().nullable()
    })
  )
};

/* engine/repoqa-dashboard.ts RepoDashboard */
const getDashboard = {
  repoId: z.string(),
  repoName: z.string().optional(),
  techStack: z.object({
    summary: z.array(
      z.object({
        category: z.string(),
        label: z.string(),
        count: z.number(),
        items: z.array(
          z.object({
            name: z.string(),
            category: z.string(),
            filePath: z.string(),
            lineStart: z.number().optional()
          })
        )
      })
    ),
    highlights: z.array(z.string())
  }),
  config: z.object({
    topology: z.array(
      z.object({
        key: z.string(),
        filePath: z.string(),
        lineStart: z.number().optional(),
        group: z.enum(['server', 'datasource', 'profile', 'other']),
        sensitive: z.boolean()
      })
    ),
    maskedValues: z.literal(true)
  }),
  scale: z.object({
    routes: z.number(),
    services: z.number(),
    repositories: z.number(),
    advices: z.number(),
    plainClasses: z.number(),
    interfaces: z.number(),
    methods: z.number(),
    fields: z.number(),
    configKeys: z.number(),
    files: z.number()
  }),
  topApis: z.array(
    z.object({
      name: z.string(),
      controller: z.string(),
      filePath: z.string(),
      lineStart: z.number(),
      depth: z.number(),
      hops: z.array(z.string())
    })
  ),
  verification: verificationReceipt
};

/* repoqa-mcp.ts mcpGetConfigEvidence */
const getConfigEvidence = {
  repoId: z.string(),
  matchedKeys: z.array(z.object({ key: z.string(), file: z.string(), line: z.number() })),
  totalMatched: z.number(),
  note: z.string(),
  verification: verificationReceipt
};

/* engine/repoqa-tours.ts RepoQaTour */
const tour = z.object({
  id: z.enum(['auth-chain', 'main-flow', 'error-handling']),
  title: z.string(),
  description: z.string(),
  steps: z.array(
    z.object({
      step: z.string(),
      filePath: z.string(),
      lineNumber: z.number(),
      symbol: z.string(),
      kind: z.string(),
      note: z.string().optional()
    })
  ),
  mermaid: z.string()
});
const getTours = {
  tours: z.array(tour),
  note: z.string().optional(),
  verification: verificationReceipt
};

/* ingest/repoqa-worker.ts reverse-deps 段 */
const reverseDeps = {
  repoId: z.string(),
  target: z.object({ name: z.string(), file: z.string(), line: z.number() }),
  callers: z.array(
    z.object({
      file: z.string(),
      method: z.string(),
      line: z.number(),
      callLine: z.number().nullable()
    })
  ),
  count: z.number(),
  fallback: z.boolean(),
  verification: verificationReceipt
};

/* engine/repoqa-diff.ts DiffReport（MCP 路径不携带 policy——那是 CLI diff 命令的附加字段） */
const getPrImpact = {
  schemaVersion: z.number(),
  summary: z.object({
    changedFiles: z.number(),
    modifiedSymbols: z.number(),
    affectedApis: z.number(),
    configChanges: z.number(),
    uncovered: z.number()
  }),
  repoPath: z.string(),
  repoName: z.string(),
  base: z.string(),
  head: z.string(),
  baseSha: z.string().optional(),
  headSha: z.string().optional(),
  changedFiles: z.array(
    z.object({
      path: z.string(),
      status: z.enum(['A', 'M', 'D', 'R', 'C', 'U']),
      java: z.boolean(),
      source: z.boolean(),
      config: z.boolean()
    })
  ),
  modifiedSymbols: z.array(
    z.object({
      kind: z.string(),
      name: z.string(),
      parentType: z.string().optional(),
      file: z.string(),
      line: z.number(),
      side: z.enum(['head', 'base']),
      changedLines: z.array(z.number())
    })
  ),
  affectedApis: z.array(
    z.object({
      controller: z.string(),
      routeMethod: z.string(),
      httpPath: z.string().optional(),
      file: z.string(),
      line: z.number(),
      annotations: z.array(z.string()).optional(),
      controllerAnnotations: z.array(z.string()).optional(),
      impacts: z.array(
        z.object({
          modifiedMethod: z.string(),
          modifiedFile: z.string(),
          modifiedLine: z.number(),
          side: z.enum(['head', 'base']),
          chain: z.array(z.string())
        })
      )
    })
  ),
  uncovered: z.array(
    z.object({
      name: z.string(),
      parentType: z.string().optional(),
      file: z.string(),
      line: z.number(),
      side: z.enum(['head', 'base'])
    })
  ),
  routeReachability: z.object({
    routeMethods: z.number(),
    productionMethods: z.number(),
    reachable: z.number()
  }),
  reachGraph: z.string(),
  configChanges: z.array(
    z.object({
      file: z.string(),
      key: z.string(),
      line: z.number(),
      status: z.enum(['added', 'modified', 'removed'])
    })
  ),
  mermaid: z.string(),
  architectureDelta: z.object({
    schemaVersion: z.number(),
    base: z.string(),
    head: z.string(),
    baseSha: z.string().optional(),
    headSha: z.string().optional(),
    addedRoutes: z.array(extractedSymbol),
    removedRoutes: z.array(extractedSymbol),
    brokenEdges: z.array(callEdge),
    impactedApis: z.array(
      z.object({
        routeSymbol: extractedSymbol,
        affectedBySymbols: z.array(z.string()),
        riskLevel: z.enum(['HIGH', 'MEDIUM', 'LOW'])
      })
    ),
    mermaid: z.string().optional()
  }),
  verification: verificationReceipt
};

/* engine/repoqa-graphrag.ts SubgraphContextResult */
const getSubgraphContext = {
  context: z.object({
    start: z.object({ name: z.string(), file: z.string(), line: z.number() }),
    nodes: z.array(
      z.object({
        name: z.string(),
        file: z.string(),
        line: z.number(),
        distance: z.number(),
        direction: z.enum(['start', 'caller', 'callee']),
        tokens: z.number()
      })
    ),
    tokenCount: z.number(),
    truncated: z.boolean(),
    prunedCount: z.number(),
    text: z.string()
  }),
  verification: verificationReceipt
};

/* domain-radar-engine.ts DomainRadarResult（packages/contracts/src/repoqa.ts:444） */
const domainRadar = {
  schemaVersion: z.number(),
  repoId: z.string(),
  matchedAnchors: z.array(
    z.object({
      symbol: z.string(),
      type: z.enum(['CONTROLLER', 'SERVICE', 'ENTITY']),
      relevanceScore: z.number(),
      filePath: z.string(),
      line: z.number(),
      matchedBy: z.enum(['identifier', 'doc-chunk']),
      inDegree: z.number(),
      outDegree: z.number()
    })
  ),
  hubNodes: z.array(
    z.object({
      symbol: z.string(),
      inDegree: z.number(),
      outDegree: z.number(),
      pagerank: z.number(),
      role: z.string()
    })
  ),
  topApis: z.array(z.string()),
  persistenceEntities: z.array(z.string()),
  verification: verificationReceipt
};

/* module-evolution-engine.ts ModuleEvolutionResult —— repoqa-mcp.ts:337-389 契约。
 * 运行时二选一:plan 形状或 convention-conflict 形状,两支都带 verification。
 * SDK 顶层只接受对象 schema(normalizeObjectSchema 对 union 返回 undefined,
 * safeParseAsync 直接崩),无法用 z.union 表达"二选一"——退化为单对象形状:
 * 两支字段全部 optional,仅 verification 必填。代价是 schema 不再排除
 * "两支字段混出"的病态载荷,换来的是全部 17 工具的统一可校验性。 */
const blastRadius = z.object({
  impactedCallersCount: z.number(),
  impactedRoutes: z.array(z.string()),
  impactedComponents: z.array(z.string()),
  orphanedSymbols: z.array(z.object({ name: z.string(), filePath: z.string(), line: z.number() }))
});
const evolutionEither = {
  // plan 分支(repoqa-mcp.ts:337-389 / module-evolution-engine.ts:814-829, 1044-1063)
  schemaVersion: z.number().optional(),
  repoId: z.string().optional(),
  intentType: z.enum(['DEPRECATE', 'EXTEND']).optional(),
  target: z.string().optional(),
  riskLevel: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  blastRadius: blastRadius.optional(),
  checklists: z
    .array(
      z.object({
        category: z.enum(['FRONTEND', 'CONTROLLER', 'SERVICE', 'PERSISTENCE', 'CONFIG']),
        action: z.enum(['DELETE', 'MODIFY', 'CREATE']),
        filePath: z.string(),
        description: z.string()
      })
    )
    .optional(),
  transactionBoundaries: z
    .array(
      z.object({
        symbol: z.string(),
        filePath: z.string(),
        line: z.number(),
        scope: z.enum(['METHOD', 'CLASS', 'INTERFACE'])
      })
    )
    .optional(),
  cockpitDeepLink: z.string().optional(),
  scaffoldTemplates: z
    .array(
      z.object({
        suggestedPattern: z.enum(['SPRING_EVENT_ASYNC', 'AOP_ASPECT', 'DIRECT_INJECTION']),
        filePath: z.string(),
        codeSnippet: z.string()
      })
    )
    .optional(),
  conventions: conventionProfile.optional(),
  placement: z
    .object({
      packagePath: z.string(),
      files: z.array(
        z.object({ filePath: z.string(), role: z.enum(['interface', 'impl', 'single']) })
      ),
      injection: z.object({
        style: z.enum(['constructor', 'field', 'unsupported']),
        codeSnippet: z.string()
      }),
      handlerSignature: z.string().optional(),
      basedOn: z.array(z.object({ axis: z.string(), verdict: z.string() }))
    })
    .optional(),
  risks: z
    .array(
      z.object({
        kind: z.enum(['transaction-warning', 'convention-split']),
        message: z.string(),
        suggestion: z.string().optional(),
        axis: z.string().optional(),
        divergentSamples: z.array(conventionAnchor).optional()
      })
    )
    .optional(),
  // convention-conflict 分支(ConventionConflictDetail,repoqa-mcp.ts:977-978)
  error: z.string().optional(),
  conventionConflict: z
    .object({
      axis: z.string(),
      verdict: z.string(),
      coverage: conventionCoverage.optional(),
      anchors: z.array(conventionAnchor).optional(),
      suggestion: z.string()
    })
    .optional(),
  verification: verificationReceipt
};

/* diagnose-engine.ts DiagnoseResult */
const diagnose = {
  schemaVersion: z.number(),
  repoId: z.string(),
  traceId: z.string(),
  entrySymbol: z.string(),
  verifiedChain: z.array(
    z.object({
      layer: z.enum(['FRONTEND_COMPONENT', 'HTTP_ROUTER', 'SERVICE', 'DATA_MAPPER']),
      symbol: z.string(),
      filePath: z.string(),
      line: z.number(),
      status: z.enum(['VERIFIED', 'BROKEN', 'SUSPECT', 'EXTERNAL']),
      diagnosticNotes: z.string().optional(),
      codeSnippet: z.string().optional()
    })
  ),
  rootCauseSummary: z.string(),
  cockpitDeepLink: z.string(),
  verification: verificationReceipt
};

/* blast-radius.ts RefactorPlanResult */
const refactorPlan = {
  schemaVersion: z.number(),
  repoId: z.string(),
  targetSymbol: z.string(),
  target: z.object({ name: z.string(), file: z.string(), line: z.number() }),
  riskLevel: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  directCallersCount: z.number(),
  indirectCallersCount: z.number(),
  impactedRoutes: z.array(z.string()),
  impactedFrontendComponents: z.array(z.string()),
  migrationSteps: z.array(z.string()),
  cockpitDeepLink: z.string(),
  verification: verificationReceipt
};

/* repoqa-mcp.ts mcpIndexRepo */
const indexRepo = {
  repoId: z.string(),
  name: z.string(),
  status: z.literal('indexing'),
  localPath: z.string(),
  pollHint: z.string(),
  verification: verificationReceipt
};

/* repoqa-mcp.ts mcpRemoveRepo */
const removeRepo = {
  removed: z.literal(true),
  repoId: z.string(),
  name: z.string(),
  verification: verificationReceipt
};

/* scan-engine.ts ScanResult —— 恒 5 桶；census/wiredExcluded 仅 orphanedPublic，note 除 oversizedFiles 外恒有。 */
const scanCandidate = z.object({
  symbol: z.string(),
  kind: z.string(),
  filePath: z.string(),
  line: z.number(),
  detail: z.string(),
  lineEnd: z.number().optional(),
  testOnly: z.boolean().optional()
});
const scan = {
  schemaVersion: z.number(),
  repoId: z.string(),
  repoName: z.string(),
  cockpitDeepLink: z.string(),
  buckets: z.array(
    z.object({
      id: z.enum(['orphanedPublic', 'hubs', 'oversized', 'deepChains', 'oversizedFiles']),
      title: z.string(),
      nextAction: z.string(),
      total: z.number(),
      items: z.array(scanCandidate),
      note: z.string().optional(),
      wiredExcluded: z.number().optional(),
      census: z
        .object({
          zeroCallers: z.number(),
          testOnly: z.number(),
          candidatesBeforeRules: z.number(),
          excluded: z.array(
            z.object({
              rule: z.string(),
              detail: z.string(),
              count: z.number().optional(),
              deferred: z.boolean().optional()
            })
          )
        })
        .optional()
    })
  ),
  verification: verificationReceipt
};

/* engine/repoqa-conventions.ts ConventionProfile（packages/contracts/src/repoqa.ts:298）
 * —— 与 conventionProfileShape 同源，get_conventions 就是裸 profile + 回执。 */
const getConventions = {
  ...conventionProfileShape,
  verification: verificationReceipt
};

/**
 * outputSchema per tool name — always an object shape (the SDK's
 * normalizeObjectSchema only accepts object schemas at the top level; a
 * z.union there returns undefined and the validation crashes), including the
 * two-shape evolution tools whose branches are all-optional fields.
 * registerPlain passes this straight to the SDK, which renders it into
 * tools/list JSON Schema and hard-validates every successful result against
 * it. Coverage of all 17 tool names is ratcheted by a test — a tool missing
 * here silently ships without the structured contract.
 *
 * Types here are re-declared by hand from packages/contracts and the engine
 * modules rather than derived: contracts ships TS interfaces only, and the
 * SDK validates runtime values, not types. A contract-type change therefore
 * needs a parallel edit here — that is the deliberate price of the schema
 * contract (mcp-tool-contract.md §六); drift surfaces as a runtime red.
 */
export const MCP_OUTPUT_SCHEMAS: Record<string, Record<string, z.ZodType>> = {
  codecompass_list_repos: listRepos,
  codecompass_trace_call_chain: traceCallChain,
  codecompass_get_dashboard: getDashboard,
  codecompass_get_config_evidence: getConfigEvidence,
  codecompass_get_tours: getTours,
  codecompass_reverse_deps: reverseDeps,
  codecompass_get_pr_impact: getPrImpact,
  codecompass_get_subgraph_context: getSubgraphContext,
  codecompass_domain_radar: domainRadar,
  codecompass_module_evolution: evolutionEither,
  codecompass_diagnose: diagnose,
  codecompass_refactor_plan: refactorPlan,
  codecompass_index_repo: indexRepo,
  codecompass_remove_repo: removeRepo,
  codecompass_scan: scan,
  codecompass_get_conventions: getConventions,
  codecompass_plan_evolution: evolutionEither
};
