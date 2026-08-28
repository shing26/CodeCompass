import { describe, expect, it } from 'vitest';
import { GoAdapter, parseGoSource } from './GoAdapter';
import { buildCallIndex, resolveCallChain } from '../repoqa-callchain';

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
