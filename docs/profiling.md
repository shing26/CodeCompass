# Profiling Baseline — Large-Scale Indexing

> Generated: 2026-08-31 · CodeCompass v0.15

## Methodology

Shallow clone (`--depth 1`) of a large open-source Java project, index with
`REPOQA_MAX_FILES=12000` (the v0.15 default), in-memory SQLite, single-thread
serial parse (the default execution mode). Machine: `process.platform=win32`,
Node 24.15, 32 GB RAM, SSD.

## Repository

| | |
|---|---|
| Target | `spring-projects/spring-boot` |
| Cloned | 2026-08-31 |
| Files scanned | 11,482 |
| Source files parsed | ~6,000+ |
| Symbols indexed | **58,535** |
| Index elapsed | **26.3 s** |
| Peak heap (RSS) | **438 MB** |

## Deterministic Graph at Scale

| Operation | Time |
|---|---|
| `buildCallIndex` (58,535 symbols → SymbolIndex) | **34 ms** |
| `resolveCallChain` depth-6 (cold) | **< 1 ms** |

The graph builds and resolves at linear time with no regression past the
v0.9 benchmarks (~2,000 symbols). The serial parser is the bottleneck, but
the measured 26 s / 438 MB already meet the v1.0 GA targets (≤ 30 s / ≤ 500 MB)
stated in the original productization plan, even without parallel parsing.

## Budget Impact

**`MAX_FILES=3000` (v0.5–v0.14) would have truncated spring-boot at ~3,000
files, missing ~75% of the codebase.** The v0.15 default of 12,000 covers the
entire project, and the file budget is now configurable via `REPOQA_MAX_FILES`
/env for users who need even larger repos.

## Conclusion

The serial path is production-capable for a project of this size. The next
hardening step is **parallel parsing via worker_threads** (tracked in
`.scratch/v1.0-parallel-parse/`), which would cut the 26 s proportionally.
Priority for the next release: **Prisma data-layer adapter** (delivers the
"4-layer penetration" promise to TypeScript/Node.js ecosystems).