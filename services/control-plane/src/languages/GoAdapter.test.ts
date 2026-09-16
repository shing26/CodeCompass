import { describe, expect, it } from 'vitest';
import { GoAdapter, buildGoPackageTable, parseGoSource } from './GoAdapter';
import type { ParseContext } from './parse-context';
import { buildCallIndex, resolveCallChain, resolveCallEdge } from '../engine/repoqa-callchain';
import type { RepoSymbol } from '../ingest/repoqa-repos';

describe('GoAdapter — symbol extraction (Issue 26)', () => {
  it('recognizes .go files and extracts struct/interface/func/const/var symbols', () => {
    expect(GoAdapter.canParse('src/main.go')).toBe(true);
    expect(GoAdapter.canParse('src/app.ts')).toBe(false);

    const source = [
      'package demo',
      '',
      'type Owner struct {',
      '  ID   int64',
      '  Name string',
      '}',
      '',
      'type OwnerService interface {',
      '  FindOne(id int64) (*Owner, error)',
      '}',
      '',
      'type ownerServiceImpl struct {',
      '  repo OwnerRepository',
      '}',
      '',
      'func (s *ownerServiceImpl) FindOne(id int64) (*Owner, error) {',
      '  return s.repo.FindOne(id)',
      '}',
      '',
      'const DefaultLimit = 10',
      '',
      'var Service OwnerService = &ownerServiceImpl{}'
    ].join('\n');
    const symbols = parseGoSource(source, 'demo/domain.go', 'repo');

    const owner = symbols.find((symbol) => symbol.name === 'Owner');
    expect(owner?.kind).toBe('class');
    expect(owner?.lineStart).toBe(3);

    const serviceIface = symbols.find((symbol) => symbol.name === 'OwnerService');
    expect(serviceIface?.kind).toBe('interface');
    expect(serviceIface?.lineStart).toBe(8);

    const impl = symbols.find((symbol) => symbol.name === 'ownerServiceImpl');
    expect(impl?.kind).toBe('class');

    const idField = symbols.find((symbol) => symbol.name === 'ID');
    expect(idField).toMatchObject({
      kind: 'field',
      parentType: 'Owner',
      type: 'int64',
      lineStart: 4
    });

    const ifaceMethod = symbols.find(
      (symbol) => symbol.name === 'FindOne' && symbol.parentType === 'OwnerService'
    );
    expect(ifaceMethod?.kind).toBe('method');
    expect(ifaceMethod?.lineStart).toBe(9);

    const implMethod = symbols.find(
      (symbol) => symbol.name === 'FindOne' && symbol.parentType === 'ownerServiceImpl'
    );
    expect(implMethod?.kind).toBe('method');
    expect(implMethod?.lineStart).toBe(16);
    expect(implMethod?.calls?.[0]).toMatchObject({
      method: 'FindOne',
      receiver: 'repo',
      receiverType: 'OwnerRepository',
      dynamic: false
    });

    const limit = symbols.find((symbol) => symbol.name === 'DefaultLimit');
    expect(limit?.kind).toBe('field');
    expect(limit?.lineStart).toBe(20);

    const serviceVar = symbols.find((symbol) => symbol.name === 'Service');
    expect(serviceVar).toMatchObject({
      kind: 'field',
      type: 'OwnerService',
      lineStart: 22
    });
  });

  it('extracts Gin routes with group prefix and handler edges', () => {
    const source = [
      'package main',
      '',
      'import "github.com/gin-gonic/gin"',
      '',
      'func main() {',
      '  r := gin.Default()',
      '  r.GET("/owners", listOwners)',
      '  group := r.Group("/api")',
      '  group.POST("/orders", createOrder)',
      '}',
      '',
      'func listOwners(c *gin.Context) {}',
      'func createOrder(c *gin.Context) {}'
    ].join('\n');
    const symbols = parseGoSource(source, 'main.go', 'repo');

    const getRoute = symbols.find((symbol) => symbol.name === 'GET /owners');
    expect(getRoute).toMatchObject({
      kind: 'route',
      displayPath: '/owners',
      lineStart: 7
    });
    expect(getRoute?.calls).toEqual([
      { file: 'main.go', method: 'listOwners', line: 7, dynamic: false }
    ]);

    const postRoute = symbols.find((symbol) => symbol.name === 'POST /api/orders');
    expect(postRoute?.displayPath).toBe('/api/orders');
    expect(postRoute?.calls?.[0]?.method).toBe('createOrder');
  });

  it('extracts Fiber routes with title-case verbs', () => {
    const source = [
      'package main',
      '',
      'import "github.com/gofiber/fiber/v2"',
      '',
      'func main() {',
      '  app := fiber.New()',
      '  app.Get("/health", health)',
      '}',
      '',
      'func health(c *fiber.Ctx) error { return nil }'
    ].join('\n');
    const symbols = parseGoSource(source, 'main.go', 'repo');

    const route = symbols.find((symbol) => symbol.name === 'Get /health');
    expect(route?.kind).toBe('route');
    expect(route?.displayPath).toBe('/health');
    expect(route?.calls?.[0]?.method).toBe('health');
  });

  it('infers interface implementations from package vars and resolves call chains', () => {
    const source = [
      'package demo',
      '',
      'type OwnerService interface {',
      '  FindOne(id int64) (*Owner, error)',
      '}',
      '',
      'type ownerServiceImpl struct{}',
      '',
      'func (s *ownerServiceImpl) FindOne(id int64) (*Owner, error) {',
      '  return nil, nil',
      '}',
      '',
      'var DefaultService OwnerService = &ownerServiceImpl{}',
      '',
      'func getOwner(svc OwnerService) {',
      '  svc.FindOne(1)',
      '}'
    ].join('\n');
    const symbols = parseGoSource(source, 'demo/service.go', 'repo');

    const impl = symbols.find((symbol) => symbol.name === 'ownerServiceImpl');
    expect(impl?.interfaces).toContain('OwnerService');

    const start = symbols.find((symbol) => symbol.name === 'getOwner');
    expect(start?.calls?.[0]).toMatchObject({
      method: 'FindOne',
      receiver: 'svc',
      receiverType: 'OwnerService',
      dynamic: false
    });

    const trace = resolveCallChain(symbols, start!, 4);
    expect(trace.map((hop) => hop.method)).toEqual(['getOwner', 'FindOne']);
    expect(trace[1].file).toBe('demo/service.go');
  });
});


describe('v0.7 — go statement async marker', () => {
  it('marks goroutine dispatch edges without dropping them', () => {
    const source = [
      'package main',
      '',
      'type Worker struct{}',
      '',
      'func (w *Worker) Process(msg string) {}',
      '',
      'func main() {',
      '  w := &Worker{}',
      '  go w.Process("job")',
      '  w.Process("sync")',
      '}'
    ].join('\n');
    const symbols = parseGoSource(source, 'main.go', 'r1');
    const main = symbols.find((symbol) => symbol.name === 'main');
    const processCalls = (main?.calls ?? []).filter((call) => call.method === 'Process');
    expect(processCalls.length).toBe(2);
    expect(processCalls.filter((call) => call.async).length).toBe(1);
  });
});

describe('Issue 02 (dogfooding) — Go call-edge resolution', () => {
  it('records package-level bare calls as static and resolves them across files', () => {
    const entry = [
      'package app',
      '',
      'func Start(buildInfo *BuildInfo) {',
      '  Run(buildInfo)',
      '}'
    ].join('\n');
    const runFile = [
      'package app',
      '',
      'func Run(buildInfo *BuildInfo) {}'
    ].join('\n');
    // Decoy: same name in another package must NOT capture the bare call.
    const decoyFile = [
      'package integration',
      '',
      'func Run() {}'
    ].join('\n');

    const entrySymbols = parseGoSource(entry, 'pkg/app/entry_point.go', 'r1');
    const start = entrySymbols.find((symbol) => symbol.name === 'Start');
    expect(start?.calls?.[0]).toMatchObject({ method: 'Run', dynamic: false });

    const runSymbols = parseGoSource(runFile, 'pkg/app/app.go', 'r1');
    const decoySymbols = parseGoSource(decoyFile, 'pkg/integration/types.go', 'r1');
    const all = [...entrySymbols, ...runSymbols, ...decoySymbols];
    const trace = resolveCallChain(all, start!, 4);
    expect(trace.map((hop) => hop.method)).toEqual(['Start', 'Run']);
    expect(trace[trace.length - 1].file).toBe('pkg/app/app.go');
  });

  it('resolves import-qualified calls through the pkg stamp', () => {
    const main = [
      'package main',
      '',
      'import (',
      '  "example.com/mod/pkg/app"',
      '  "example.com/mod/pkg/extra"',
      ')',
      '',
      'func main() {',
      '  app.Start()',
      '  extra.Noise()',
      '}'
    ].join('\n');
    const appFile = [
      'package app',
      '',
      'func Start() {}'
    ].join('\n');

    const mainSymbols = parseGoSource(main, 'main.go', 'r1');
    const mainFn = mainSymbols.find((symbol) => symbol.name === 'main');
    expect(mainFn?.calls?.[0]).toMatchObject({
      method: 'Start',
      dynamic: false,
      pkg: 'app'
    });

    const appSymbols = parseGoSource(appFile, 'pkg/app/app.go', 'r1');
    const all = [...mainSymbols, ...appSymbols];
    // extra.Noise has no indexed target → deterministic break, not a guess.
    const trace = resolveCallChain(all, mainFn!, 4);
    expect(trace.map((hop) => hop.method)).toEqual(['main', 'Start']);
  });
});

/** V31-02 — same-file receiver typing, the dominant cause of lazygit's
 * "zero static callers" report: `app := ...` left every `app.Method()` edge
 * dynamic, so the callee was published as an orphan. */
describe('V31-02 — Go local type inference', () => {
  function callsOf(symbols: RepoSymbol[], name: string) {
    return (symbols.find((symbol) => symbol.name === name)?.calls ?? []).map((call) => ({
      receiver: call.receiver,
      receiverType: call.receiverType,
      method: call.method,
      dynamic: call.dynamic
    }));
  }

  /** Receiver-typed calls only: builtin and conversion callees (`new`, `Cache`)
   * are recorded as package-level bare calls too, and are not what is asserted. */
  function typedCallsOf(symbols: RepoSymbol[], name: string) {
    return callsOf(symbols, name).filter((call) => call.receiver !== undefined);
  }

  it('types a short declaration from a composite literal, its address, or new', () => {
    const source = [
      'package demo',
      '',
      'type App struct{}',
      '',
      'func (app *App) Run() {}',
      '',
      'func main() {',
      '  a := &App{}',
      '  b := App{}',
      '  c := new(App)',
      '  a.Run()',
      '  b.Run()',
      '  c.Run()',
      '}'
    ].join('\n');
    expect(typedCallsOf(parseGoSource(source, 'demo/app.go', 'r'), 'main')).toEqual([
      { receiver: 'a', receiverType: 'App', method: 'Run', dynamic: false },
      { receiver: 'b', receiverType: 'App', method: 'Run', dynamic: false },
      { receiver: 'c', receiverType: 'App', method: 'Run', dynamic: false }
    ]);
  });

  it('types a short declaration from a same-file function result, by position', () => {
    const source = [
      'package demo',
      '',
      'type App struct{}',
      '',
      'func (app *App) Run() {}',
      '',
      'func NewApp() (*App, error) { return nil, nil }',
      '',
      'func main() {',
      '  app, err := NewApp()',
      '  if err != nil {',
      '    return',
      '  }',
      '  app.Run()',
      '}'
    ].join('\n');
    const symbols = parseGoSource(source, 'demo/app.go', 'r');
    const runCall = (symbols.find((symbol) => symbol.name === 'main')?.calls ?? []).find(
      (call) => call.method === 'Run'
    );
    expect(runCall).toMatchObject({ receiverType: 'App', dynamic: false });
  });

  it('types a short declaration from a type conversion and an annotated var', () => {
    const source = [
      'package demo',
      '',
      'type Cache interface { Get(key string) string }',
      '',
      'type memCache struct{}',
      '',
      'func (m *memCache) Get(key string) string { return "" }',
      '',
      'func main() {',
      '  a := Cache(&memCache{})',
      '  var b Cache = &memCache{}',
      '  a.Get("x")',
      '  b.Get("y")',
      '}'
    ].join('\n');
    expect(typedCallsOf(parseGoSource(source, 'demo/cache.go', 'r'), 'main')).toEqual([
      { receiver: 'a', receiverType: 'Cache', method: 'Get', dynamic: false },
      { receiver: 'b', receiverType: 'Cache', method: 'Get', dynamic: false }
    ]);
  });

  it('types a generic instantiation but never an indexed func value', () => {
    const source = [
      'package demo',
      '',
      'type Map[K comparable, V any] struct{}',
      '',
      'func (m *Map[K, V]) Set(k K, v V) {}',
      '',
      'func NewMap[K comparable, V any]() *Map[K, V] { return nil }',
      '',
      'var handlers = []func(){}',
      '',
      'func main() {',
      '  m := NewMap[string, int]()',
      '  m.Set("a", 1)',
      '  handlers[0]()',
      '}'
    ].join('\n');
    const calls = parseGoSource(source, 'demo/map.go', 'r').find(
      (symbol) => symbol.name === 'main'
    )?.calls;
    // `NewMap[string, int]()` instantiates a declared function, so its result
    // type is a fact about the file — `*Map[K, V]` names `Map`.
    expect(calls?.find((call) => call.method === 'Set')).toMatchObject({
      receiver: 'm',
      receiverType: 'Map',
      dynamic: false
    });
    // `handlers[0]()` reads a func value out of a slice, not a declaration:
    // no receiver may be invented for it.
    expect(calls?.some((call) => call.receiver === 'handlers')).toBe(false);
  });

  it('records a call edge for a generic call site', () => {
    const source = [
      'package demo',
      '',
      'func Make[T any]() T { var zero T; return zero }',
      '',
      'func Deserialize[T any](raw string) T { var zero T; return zero }',
      '',
      'func use() {',
      '  x := Make[int]()',
      '  Deserialize[string]("a")',
      '  _ = x',
      '}'
    ].join('\n');
    const calls = parseGoSource(source, 'demo/generic.go', 'r').find(
      (symbol) => symbol.name === 'use'
    )?.calls;
    // `Make[int]()` sits in an initializer and `Deserialize[string]("a")` is a
    // standalone statement; both are calls, neither is a value lookup.
    expect(calls?.map((call) => call.method)).toEqual(
      expect.arrayContaining(['Make', 'Deserialize'])
    );
    expect(calls?.find((call) => call.method === 'Deserialize')).toMatchObject({ dynamic: false });
  });

  it('leaves an unknown result type dynamic instead of guessing a receiver', () => {
    const source = [
      'package demo',
      '',
      'import "example.com/ext"',
      '',
      'type App struct{}',
      '',
      'func (app *App) Run() {}',
      '',
      'func main() {',
      '  app := ext.Make()',
      '  app.Run()',
      '}'
    ].join('\n');
    const symbols = parseGoSource(source, 'demo/app.go', 'r');
    const runCall = (symbols.find((symbol) => symbol.name === 'main')?.calls ?? []).find(
      (call) => call.method === 'Run'
    );
    // No package table for `ext` → the edge keeps the dynamic marker.
    expect(runCall).toMatchObject({ receiver: 'app', dynamic: true });
    expect(runCall?.receiverType).toBeUndefined();
  });

  it('records pointer and qualified field types so chained calls bind', () => {
    const source = [
      'package demo',
      '',
      'type App struct {',
      '  Repo *repo.Store',
      '  closer io.Closer',
      '}',
      '',
      'func (app *App) Run() {',
      '  app.Repo.FindOne(1)',
      '}'
    ].join('\n');
    const symbols = parseGoSource(source, 'demo/app.go', 'r');
    expect(symbols.find((symbol) => symbol.name === 'Repo')).toMatchObject({
      kind: 'field',
      parentType: 'App',
      type: 'Store'
    });
    expect(symbols.find((symbol) => symbol.name === 'closer')).toMatchObject({ type: 'Closer' });
    expect(callsOf(symbols, 'Run')).toEqual([
      { receiver: 'Repo', receiverType: 'Store', method: 'FindOne', dynamic: false }
    ]);
  });

  it('binds a bare call inside a method to the package function, not the type', () => {
    const source = [
      'package app',
      '',
      'type App struct{}',
      '',
      'func ErrorMessage(code int) string { return "" }',
      '',
      'func (app *App) Validate() string {',
      '  return ErrorMessage(1)',
      '}'
    ].join('\n');
    const symbols = parseGoSource(source, 'app/app.go', 'r');
    const validate = symbols.find((symbol) => symbol.name === 'Validate');
    // Go has no implicit receiver: the call must not carry the enclosing type,
    // or resolution takes the type path and finds no such method.
    expect(validate?.calls?.[0]).toMatchObject({ method: 'ErrorMessage', dynamic: false });
    expect(validate?.calls?.[0]?.receiverType).toBeUndefined();
    expect(validate?.calls?.[0]?.receiver).toBeUndefined();

    const runSymbols = parseGoSource(
      ['package app', '', 'func ErrorMessage(code int) string { return "" }'].join('\n'),
      'app/messages.go',
      'r'
    );
    const all = [...symbols, ...runSymbols];
    const resolved = resolveCallEdge(buildCallIndex(all), validate!, validate!.calls![0]);
    expect('target' in resolved && resolved.target.name).toBe('ErrorMessage');
  });
});

/** V31-02 — the mirror image: a Go package spans files, so a value produced by
 * another file's function could not be typed at all. */
describe('V31-02 — Go package table (cross-file)', () => {
  const appFile = ['package pkg', '', 'type App struct{}', '', 'func (app *App) Run() {}'].join('\n');
  const ctorFile = ['package pkg', '', 'func NewApp() (*App, error) { return nil, nil }'].join('\n');
  const useFile = [
    'package pkg',
    '',
    'func Use() {',
    '  app, err := NewApp()',
    '  if err != nil {',
    '    return',
    '  }',
    '  app.Run()',
    '}'
  ].join('\n');

  function resolveRun(context: ParseContext | undefined) {
    const files = [
      { relativePath: 'pkg/app.go', source: appFile },
      { relativePath: 'pkg/ctor.go', source: ctorFile },
      { relativePath: 'pkg/use.go', source: useFile }
    ];
    const symbols = files.flatMap((file) =>
      parseGoSource(file.source, file.relativePath, 'r', context)
    );
    const use = symbols.find((symbol) => symbol.name === 'Use');
    const runCall = (use?.calls ?? []).find((call) => call.method === 'Run');
    const resolved = resolveCallEdge(buildCallIndex(symbols), use!, runCall!);
    return { runCall, resolved };
  }

  it('binds a value built by another file of the same package', () => {
    const context: ParseContext = {
      goPackages: buildGoPackageTable([
        { relativePath: 'pkg/app.go', source: appFile },
        { relativePath: 'pkg/ctor.go', source: ctorFile },
        { relativePath: 'pkg/use.go', source: useFile }
      ])
    };
    const { runCall, resolved } = resolveRun(context);
    expect(runCall).toMatchObject({ receiverType: 'App', dynamic: false });
    expect('target' in resolved && resolved.target.filePath).toBe('pkg/app.go');
  });

  it('stays dynamic without a context — the single-file contract still holds', () => {
    const { runCall, resolved } = resolveRun(undefined);
    expect(runCall).toMatchObject({ receiver: 'app', dynamic: true });
    expect('reason' in resolved).toBe(true);
  });

  it('binds an import-qualified call through the import path', () => {
    const widgetFile = [
      'package other',
      '',
      'type Widget struct{}',
      '',
      'func (w *Widget) Spin() {}',
      '',
      'func Make() *Widget { return nil }'
    ].join('\n');
    const consumerFile = [
      'package pkg',
      '',
      'import "example.com/mod/other"',
      '',
      'func UseIt() {',
      '  w := other.Make()',
      '  w.Spin()',
      '}'
    ].join('\n');
    const files = [
      { relativePath: 'pkg/consumer.go', source: consumerFile },
      { relativePath: 'other/widget.go', source: widgetFile }
    ];
    const context: ParseContext = { goPackages: buildGoPackageTable(files) };
    const symbols = files.flatMap((file) => parseGoSource(file.source, file.relativePath, 'r', context));
    const useIt = symbols.find((symbol) => symbol.name === 'UseIt');
    const spinCall = (useIt?.calls ?? []).find((call) => call.method === 'Spin');
    expect(spinCall).toMatchObject({ receiverType: 'Widget', dynamic: false });
    const resolved = resolveCallEdge(buildCallIndex(symbols), useIt!, spinCall!);
    expect('target' in resolved && resolved.target.filePath).toBe('other/widget.go');
  });

  it('drops a package name claimed by two directories and a name declared twice', () => {
    const table = buildGoPackageTable([
      { relativePath: 'a/util/x.go', source: 'package util\n\nfunc Shared() int { return 1 }\n' },
      { relativePath: 'b/util/y.go', source: 'package util\n\nfunc Other() int { return 2 }\n' },
      { relativePath: 'c/one/z.go', source: 'package one\n\nfunc Dup() int { return 1 }\n' },
      { relativePath: 'c/one/w.go', source: 'package one\n\nfunc Dup() int { return 2 }\n' },
      { relativePath: 'c/one/v.go', source: 'package one\n\nfunc Unique() int { return 3 }\n' }
    ]);
    // `util` names two directories: import paths are unique, basenames are not,
    // so nothing may resolve through that name.
    expect(table.has('util')).toBe(false);
    // `Dup` is declared by two files of one package, which is not valid Go.
    expect(table.get('one')?.results.has('Dup')).toBe(false);
    expect(table.get('one')?.results.get('Unique')).toEqual(['int']);
  });

  it('keeps a name dropped for being ambiguous in its own file from coming back', () => {
    const table = buildGoPackageTable([
      // `Twice` is ambiguous *inside* one file …
      {
        relativePath: 'c/one/z.go',
        source: 'package one\n\nfunc Twice() int { return 1 }\n\nfunc Twice() int { return 2 }\n'
      },
      // … so a second file declaring it once must not resurrect it.
      { relativePath: 'c/one/w.go', source: 'package one\n\nfunc Twice() int { return 3 }\n' }
    ]);
    expect(table.get('one')?.results.has('Twice')).toBe(false);
  });
});

/** V31-02 — shadowing is decided on declaration, not on a proven type: a local
 * whose type could not be inferred still hides the package-level function or
 * import of the same name, and resolving through it would be a guess. */
describe('V31-02 — Go shadowing stays fail-closed', () => {
  it('does not resolve a call through a package function the local shadows', () => {
    const source = [
      'package demo',
      '',
      'type App struct{}',
      '',
      'func (app *App) Run() {}',
      '',
      'func Make() (*App, error) { return nil, nil }',
      '',
      'func use() {',
      '  Make := func() (*App, error) { return nil, nil }',
      '  app, err := Make()',
      '  if err != nil {',
      '    return',
      '  }',
      '  app.Run()',
      '}'
    ].join('\n');
    const runCall = (parseGoSource(source, 'demo/use.go', 'r').find(
      (symbol) => symbol.name === 'use'
    )?.calls ?? []).find((call) => call.method === 'Run');
    // `Make` here is a local func value, so the edge must keep the dynamic
    // marker rather than borrow the package function's `*App` result.
    expect(runCall).toMatchObject({ receiver: 'app', dynamic: true });
    expect(runCall?.receiverType).toBeUndefined();
  });

  it('does not stamp the package qualifier when a local shadows the import', () => {
    const source = [
      'package demo',
      '',
      'import "example.com/ext"',
      '',
      'type App struct{}',
      '',
      'func (app *App) Run() {}',
      '',
      'func use() {',
      '  ext := &App{}',
      '  ext.Run()',
      '}'
    ].join('\n');
    const runCall = (parseGoSource(source, 'demo/use.go', 'r').find(
      (symbol) => symbol.name === 'use'
    )?.calls ?? []).find((call) => call.method === 'Run');
    expect(runCall).toMatchObject({ receiverType: 'App', dynamic: false });
    expect(runCall?.pkg).toBeUndefined();
  });
});

