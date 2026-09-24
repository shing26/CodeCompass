import { describe, expect, it } from 'vitest';
import {
  TypeScriptAdapter,
  buildTypeScriptDeclarations,
  parseTypeScriptSource
} from './TypeScriptAdapter';
import type { ParseContext, TypeScriptDeclarations } from './parse-context';
import { buildCallIndex, resolveCallEdge } from '../engine/repoqa-callchain';

describe('TypeScriptAdapter — symbol extraction (Issue 25)', () => {
  it('recognizes TS files and extracts plain class/function/interface/type symbols', () => {
    expect(TypeScriptAdapter.canParse('src/app.ts')).toBe(true);
    expect(TypeScriptAdapter.canParse('src/app.tsx')).toBe(true);
    expect(TypeScriptAdapter.canParse('src/app.js')).toBe(true);
    expect(TypeScriptAdapter.canParse('src/app.jsx')).toBe(true);
    expect(TypeScriptAdapter.canParse('src/app.mjs')).toBe(true);
    expect(TypeScriptAdapter.canParse('src/app.java')).toBe(false);

    const source = `
export interface Pet { id: string }
export type PetKind = 'cat' | 'dog';
export class PetService {
  name: string;
  findOne(id: string) { return this.name; }
}
export function listPets() { return []; }
export const findPet = (id: string) => id;
`;
    const symbols = parseTypeScriptSource(source, 'src/pets.ts', 'repo');

    const petInterface = symbols.find((symbol) => symbol.name === 'Pet');
    expect(petInterface?.kind).toBe('interface');
    expect(petInterface?.filePath).toBe('src/pets.ts');
    expect(petInterface?.lineStart).toBe(2);
    expect(petInterface?.lineEnd).toBe(2);

    const petKind = symbols.find((symbol) => symbol.name === 'PetKind');
    expect(petKind?.kind).toBe('interface');
    expect(petKind?.lineStart).toBe(3);

    const service = symbols.find((symbol) => symbol.name === 'PetService');
    expect(service?.kind).toBe('service');
    expect(symbols.find((symbol) => symbol.name === 'name')?.kind).toBe('field');

    const findOne = symbols.find((symbol) => symbol.name === 'findOne');
    expect(findOne?.kind).toBe('method');
    expect(findOne?.parentType).toBe('PetService');
    expect(findOne?.lineStart).toBe(6);

    expect(symbols.find((symbol) => symbol.name === 'listPets')?.kind).toBe('method');
    expect(symbols.find((symbol) => symbol.name === 'findPet')?.kind).toBe('method');
  });

  it('extracts NestJS controller and route method symbols', () => {
    const source = `
import { Controller, Get, Post, Param, Body } from '@nestjs/common';

@Controller('owners')
export class OwnersController {
  @Get(':id')
  getOne(@Param('id') id: string): string {
    return 'ok';
  }

  @Post()
  create(@Body() body: unknown): void {}
}
`;
    const symbols = parseTypeScriptSource(source, 'src/owners.controller.ts', 'repo');

    const controller = symbols.find(
      (symbol) => symbol.kind === 'route' && symbol.name === 'OwnersController'
    );
    expect(controller?.displayPath).toBe('owners');
    expect(controller?.annotations).toContain("@Controller('owners')");

    const getOne = symbols.find((symbol) => symbol.name === 'getOne');
    expect(getOne?.kind).toBe('method');
    expect(getOne?.parentType).toBe('OwnersController');
    expect(getOne?.displayPath).toBe('owners/:id');

    const create = symbols.find((symbol) => symbol.name === 'create');
    expect(create?.displayPath).toBe('owners');
  });

  it('extracts Express app/router routes with handler call edges', () => {
    const source = `
import express from 'express';
const app = express();
const router = express.Router();

app.get('/owners', getOwners);
router.post('/orders', createOrder);

function getOwners() { return []; }
function createOrder() {}
`;
    const symbols = parseTypeScriptSource(source, 'src/routes.ts', 'repo');

    const getRoute = symbols.find(
      (symbol) => symbol.kind === 'route' && symbol.name === 'GET /owners'
    );
    expect(getRoute?.displayPath).toBe('/owners');
    expect(getRoute?.calls).toEqual([
      { file: 'src/routes.ts', method: 'getOwners', line: 6, dynamic: false }
    ]);

    const postRoute = symbols.find(
      (symbol) => symbol.kind === 'route' && symbol.name === 'POST /orders'
    );
    expect(postRoute?.displayPath).toBe('/orders');
    expect(postRoute?.calls?.[0]?.method).toBe('createOrder');
  });

  it('extracts axios and fetch HTTP calls with method and URL', () => {
    const source = `
import axios from 'axios';

export async function loadOwners() {
  const res = await axios.get('/api/owners');
  return res;
}

export async function loadPets() {
  return fetch('/api/pets');
}
`;
    const symbols = parseTypeScriptSource(source, 'src/api.ts', 'repo');

    const loadOwners = symbols.find((symbol) => symbol.name === 'loadOwners');
    expect(loadOwners?.calls?.[0]).toMatchObject({
      method: '/api/owners',
      receiver: 'axios',
      receiverType: 'http',
      dynamic: true,
      http: { method: 'GET', url: '/api/owners' }
    });

    const loadPets = symbols.find((symbol) => symbol.name === 'loadPets');
    expect(loadPets?.calls?.[0]).toMatchObject({
      method: '/api/pets',
      receiver: 'fetch',
      receiverType: 'http',
      dynamic: true,
      http: { method: 'GET', url: '/api/pets' }
    });
  });

  it('extracts apiClient aliases and dynamic path expressions (v0.5.1 D8)', () => {
    const source = `
import axios from 'axios';
export const apiClient = axios.create({ baseURL: '/api/v1' });
export async function likePost(id: string) {
  await apiClient.post('/posts/' + id + '/like');
}
export async function fetchDetail(id: string) {
  await apiClient.request('/posts/' + id, { method: 'DELETE' });
}
`;
    const symbols = parseTypeScriptSource(source, 'src/api.ts', 'repo');
    const like = symbols.find((symbol) => symbol.name === 'likePost');
    expect(like?.calls?.[0]?.http).toEqual({
      method: 'POST',
      url: '/api/v1/posts/{id}/like'
    });
    const detail = symbols.find((symbol) => symbol.name === 'fetchDetail');
    expect(detail?.calls?.[0]?.http).toEqual({
      method: 'DELETE',
      url: '/api/v1/posts/{id}'
    });
  });

  it('treats imported http client aliases as HTTP calls even without baseURL', () => {
    const source = `
export async function likePost(id: string) {
  await apiClient.post('/posts/' + id + '/like');
}
`;
    const symbols = parseTypeScriptSource(source, 'src/PostDetailPage.tsx', 'repo');
    const like = symbols.find((symbol) => symbol.name === 'likePost');
    expect(like?.calls?.[0]?.http).toEqual({
      method: 'POST',
      url: '/posts/{id}/like'
    });
  });

  it('promotes nested arrow handlers inside components to traceable methods (v0.5.1 D8)', () => {
    const source = `
export default function PostDetailPage() {
  const handleLike = async () => {
    await apiClient.post('/posts/' + id + '/like');
  };
  const handleDelete = function () {
    return apiClient.delete('/posts/' + post.id);
  };
  return null;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/PostDetailPage.tsx', 'repo');

    const handleLike = symbols.find((symbol) => symbol.name === 'handleLike');
    expect(handleLike).toBeDefined();
    expect(handleLike?.kind).toBe('method');
    expect(handleLike?.calls?.[0]?.http).toEqual({
      method: 'POST',
      url: '/posts/{id}/like'
    });

    const handleDelete = symbols.find((symbol) => symbol.name === 'handleDelete');
    expect(handleDelete).toBeDefined();
    expect(handleDelete?.calls?.[0]?.http).toEqual({
      method: 'DELETE',
      url: '/posts/{id}'
    });

    const component = symbols.find((symbol) => symbol.name === 'PostDetailPage');
    expect(component?.calls ?? []).not.toContainEqual(
      expect.objectContaining({ http: { method: 'POST', url: '/posts/{id}/like' } })
    );
  });

  it('recognizes ky, ofetch and $fetch HTTP clients with prefixUrl (v0.6.0)', () => {
    const source = `
import ky from 'ky';

export const api = ky.create({ prefixUrl: '/api/v2' });

export async function loadOrders() {
  await api.get('/orders');
  await $fetch('/pets', { method: 'POST' });
}

export async function loadUsers() {
  return ofetch('/users');
}
`;
    const symbols = parseTypeScriptSource(source, 'src/api.ts', 'repo');

    const loadOrders = symbols.find((symbol) => symbol.name === 'loadOrders');
    const httpCalls = (loadOrders?.calls ?? [])
      .map((call) => call.http)
      .filter((http) => http !== undefined);
    expect(httpCalls).toContainEqual({ method: 'GET', url: '/api/v2/orders' });
    expect(httpCalls).toContainEqual({ method: 'POST', url: '/pets' });

    const loadUsers = symbols.find((symbol) => symbol.name === 'loadUsers');
    expect(loadUsers?.calls?.[0]?.http).toEqual({ method: 'GET', url: '/users' });
  });

  it('issue 11 attribution: typed hook param + nested callback resolves its receiver', () => {
    // Mirrors apps/repoqa-web/src/hooks/useRepoCatalog.ts — the shape behind
    // the scan top-10 finding (8/10 RepoQAClient.* false positives).
    const source = `
import type { RepoQAClient } from '../client/RepoQAClient';
export function useCatalog(client: RepoQAClient, initialId?: string | null) {
  const refresh = useCallback(async (): Promise<string[]> => {
    const list = await client.listRepos();
    return list;
  }, [client]);
  return refresh;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/hooks/useCatalog.ts', 'repo');
    const hook = symbols.find((symbol) => symbol.name === 'useCatalog');
    const call = hook?.calls?.find((entry) => entry.method === 'listRepos');
    expect(
      call,
      `symbols=${JSON.stringify(symbols.map((s) => ({ name: s.name, calls: s.calls })))}`
    ).toBeDefined();
    expect(call?.receiverType).toBe('RepoQAClient');
    expect(call?.dynamic).toBe(false);
  });

  it('issue 11 second hop: the typed receiver binds to the cross-file class method', () => {    const classSource = `
export class RepoQAClient {
  constructor(baseURL: string) {}
  async listRepos(): Promise<string[]> { return []; }
}
`;
    const hookSource = `
import type { RepoQAClient } from '../client/RepoQAClient';
export function useCatalog(client: RepoQAClient) {
  const refresh = useCallback(async () => {
    const list = await client.listRepos();
    return list;
  }, [client]);
  return refresh;
}
`;
    const classSymbols = parseTypeScriptSource(classSource, 'src/client/RepoQAClient.ts', 'r');
    const hookSymbols = parseTypeScriptSource(hookSource, 'src/hooks/useCatalog.ts', 'r');
    const symbols = [...classSymbols, ...hookSymbols];
    const index = buildCallIndex(symbols);
    const hook = hookSymbols.find((symbol) => symbol.name === 'useCatalog')!;
    const call = hook.calls!.find((entry) => entry.method === 'listRepos')!;
    const resolved = resolveCallEdge(index, hook, call);
    expect('target' in resolved && resolved.target.name).toBe('listRepos');
    expect('target' in resolved && resolved.target.parentType).toBe('RepoQAClient');
  });

  it('issue 11: destructured props bind member-wise from the inline type literal', () => {
    // RepoProvider({ client, children }: { client: RepoQAClient; … }) — the
    // dominant React parameter shape (RepoContext.tsx:87).
    const source = `
export function RepoProvider({ client, children }: { client: RepoQAClient; children: ReactNode }) {
  const clone = useCallback(async (url: string) => {
    const repo = await client.cloneRepo(url);
    return repo;
  }, [client]);
  return children;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/context/RepoContext.tsx', 'r');
    const provider = symbols.find((symbol) => symbol.name === 'RepoProvider');
    const call = provider?.calls?.find((entry) => entry.method === 'cloneRepo');
    expect(call?.receiverType).toBe('RepoQAClient');
    expect(call?.dynamic).toBe(false);
  });

  it('issue 11: a const-assigned nested arrow reaches the outer typed param', () => {
    // The handleCloneRemote shape (RepoContext.tsx:334) — its arrow gets its
    // own scope, so the lookup must walk the closure chain outward.
    const source = `
export function RepoProvider({ client, children }: { client: RepoQAClient; children: ReactNode }) {
  const handleCloneRemote = async (url: string): Promise<Repo> => {
    const repo = await client.cloneRepo(url);
    return repo;
  };
  return handleCloneRemote;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/context/RepoContext.tsx', 'r');
    const handler = symbols.find((symbol) => symbol.name === 'handleCloneRemote');
    const call = handler?.calls?.find((entry) => entry.method === 'cloneRepo');
    expect(call?.receiverType).toBe('RepoQAClient');
    expect(call?.dynamic).toBe(false);
  });

  it('issue 11: an untyped inner redeclaration shadows the outer typed binding (fail-closed)', () => {
    const source = `
export function outer(client: RepoQAClient) {
  function inner() {
    const client = getClient();
    client.listRepos();
  }
  return inner;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/x.ts', 'r');
    const inner = symbols.find((symbol) => symbol.name === 'inner');
    const call = inner?.calls?.find((entry) => entry.method === 'listRepos');
    // The nearest binding of `client` is the untyped local — the typed outer
    // parameter must NOT be revived for it.
    expect(call?.receiverType).toBeUndefined();
    expect(call?.dynamic).toBe(true);
  });

  it('issue 18(g) attribution: named props interface member + Pick<> — where does it break?', () => {
    // Mirrors EvolutionView.tsx:22 / CiGateView.tsx:19 / ArchitectureDeltaView.tsx:13:
    //   interface XProps { client?: Pick<RepoQAClient, 'radar'> }
    //   function X({ client }: XProps) { … client.radar(…) }
    const source = `
import type { RepoQAClient } from '../client/RepoQAClient';
interface EvolutionViewProps {
  repo: Repo;
  client?: Pick<RepoQAClient, 'radar'>;
}
export function EvolutionView({ client }: EvolutionViewProps) {
  const load = useCallback(async () => {
    const hubs = await client.radar(repo.id, '');
    return hubs;
  }, [client]);
  return load;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/components/EvolutionView.tsx', 'repo');
    const component = symbols.find((symbol) => symbol.name === 'EvolutionView');
    const call = component?.calls?.find((entry) => entry.method === 'radar');
    expect(
      call,
      `symbols=${JSON.stringify(symbols.map((s) => ({ name: s.name, kind: s.kind, calls: s.calls })))}`
    ).toBeDefined();
    // Attribution result (2026-09-21): TWO independent breaks had to be fixed —
    // (1) a NAMED props interface's members were never bound (only inline
    // literals were), and (2) `Pick<T, K>` was never expanded. Each was proven
    // broken in isolation by the four-variant probe in ticket 18.
    expect(call?.receiverType).toBe('RepoQAClient');
    expect(call?.dynamic).toBe(false);
  });

  it('issue 18(g) anti-false-edge: a Pick<> receiver must NOT expose members outside K', () => {
    // The whole point of carrying the allowed set: expanding Pick<T,K> to plain T
    // would resolve deleteRepo() into an edge the type system does not have —
    // trading a false positive for the worse failure (a false negative).
    const source = `
interface Props { client?: Pick<RepoQAClient, 'radar'>; }
export function View({ client }: Props) {
  const load = useCallback(async () => {
    await client.radar('r', '');
    await client.deleteRepo('x');
  }, [client]);
  return load;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/components/View.tsx', 'repo');
    const component = symbols.find((symbol) => symbol.name === 'View');
    const allowed = component?.calls?.find((entry) => entry.method === 'radar');
    const outOfScope = component?.calls?.find((entry) => entry.method === 'deleteRepo');
    expect(allowed?.receiverType).toBe('RepoQAClient');
    expect(allowed?.dynamic).toBe(false);
    // Not in K → stays dynamic (no invented edge).
    expect(outOfScope?.receiverType).toBeUndefined();
    expect(outOfScope?.dynamic).toBe(true);
  });

  it('issue 18(g) fail-closed: unions and non-name Pick keys bind nothing', () => {
    const source = `
interface A { client?: RepoQAClient | RepoQAClient2; }
interface B { client?: Pick<RepoQAClient, keyof RepoQAClient>; }
export function V1({ client }: A) {
  const load = useCallback(async () => { await client.radar('r', ''); }, [client]);
  return load;
}
export function V2({ client }: B) {
  const load = useCallback(async () => { await client.radar('r', ''); }, [client]);
  return load;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/components/U.tsx', 'repo');
    for (const name of ['V1', 'V2']) {
      const fn = symbols.find((symbol) => symbol.name === name);
      const call = fn?.calls?.find((entry) => entry.method === 'radar');
      expect(call?.receiverType, name).toBeUndefined();
      expect(call?.dynamic, name).toBe(true);
    }
  });

  it('issue 18(g) regressions: multi-name Pick keys and a function-typed member must not break binding', () => {
    // Two real defects found by the ticket's four-variant probe (2026-09-21):
    //   1. a NAIVE `split('|')` for union-stripping tore `Pick<X, 'a' | 'b'>`
    //      apart, so a two-name Pick silently failed while the one-name form
    //      worked (the `|` lives inside `<>`, at depth 1);
    //   2. counting the `>` of `=>` as a generic close drove the depth counter
    //      negative and swallowed every member AFTER a function-typed one.
    const source = `
interface Props {
  onNavigate?: (file: string, line: number) => void;
  client?: Pick<RepoQAClient, 'runGate' | 'listGateRuns'>;
}
export function View({ client }: Props) {
  const loadHistory = useCallback(async () => {
    const page = await client.listGateRuns('r', { limit: 20 });
    return page;
  }, [client]);
  const handleRun = async () => {
    const run = await client.runGate('r', 'a', 'b', {});
    return run;
  };
  return null;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/components/View.tsx', 'repo');
    const component = symbols.find((symbol) => symbol.name === 'View');
    const list = component?.calls?.find((entry) => entry.method === 'listGateRuns');
    expect(list?.receiverType).toBe('RepoQAClient');
    expect(list?.dynamic).toBe(false);
    // The second call sits in a `const handleRun = async () => …` arrow, which
    // gets its OWN scope — the closure chain must reach the component's params.
    const handleRun = symbols.find((symbol) => symbol.name === 'handleRun');
    const run = handleRun?.calls?.find((entry) => entry.method === 'runGate');
    expect(run?.receiverType).toBe('RepoQAClient');
    expect(run?.dynamic).toBe(false);
  });

  it('issue 18(f): a useMemo factory instance binds, a collection of instances does NOT', () => {
    // App.tsx:38 shape — the instance lives behind the arrow, so the direct-child
    // lookup misses it. And the anti-example: `items.map(u => new User(u))` is an
    // ARRAY of instances; mistyping it as `User` would invent edges.
    const source = `
export function App({ clientProp }: { clientProp?: RepoQAClient }) {
  const client = useMemo(() => clientProp ?? new RepoQAClient(resolveBaseUrl()), [clientProp]);
  const users = items.map((u) => new User(u));
  const boot = useCallback(() => {
    client.pickFolder();
    users.pickFolder();
  }, [client, users]);
  return boot;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/App.tsx', 'repo');
    const app = symbols.find((symbol) => symbol.name === 'App');
    const direct = app?.calls?.find((entry) => entry.receiver === 'client');
    const collection = app?.calls?.find((entry) => entry.receiver === 'users');
    expect(direct?.receiverType).toBe('RepoQAClient');
    expect(direct?.dynamic).toBe(false);
    // The collection must stay dynamic — this is the fail-closed guard.
    expect(collection?.receiverType).toBeUndefined();
    expect(collection?.dynamic).toBe(true);
  });

  it('issue 11: a `new` expression records a constructor call edge', () => {
    const source = `
import { RepoQAClient } from './client/RepoQAClient';
const client = new RepoQAClient('/api');
export function boot() {
  return client;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/boot.ts', 'r');
    // Module-level new: attributed to the nearest enclosing symbol (the boot
    // function here has none — use a function-wrapped case instead).
    const wrapped = parseTypeScriptSource(
      `
import { RepoQAClient } from './client/RepoQAClient';
export function makeClient() {
  return new RepoQAClient('/api');
}
`,
      'src/boot.ts',
      'r'
    );
    const makeClient = wrapped.find((symbol) => symbol.name === 'makeClient');
    const call = makeClient?.calls?.find((entry) => entry.method === 'constructor');
    expect(call?.receiverType).toBe('RepoQAClient');
    expect(call?.dynamic).toBe(false);
    // The module-level case must not crash or emit a bogus edge.
    expect(symbols.every((symbol) => (symbol.calls ?? []).every((entry) => entry.method !== 'constructor' || entry.receiver === 'RepoQAClient'))).toBe(true);
  });
});

/**
 * Issue 18(f)2/(e) — the cross-file declaration table. Every case below is one
 * of the shapes the self-repo top-10 actually contained, or an anti-example that
 * must stay dynamic. The table is built by `buildTypeScriptDeclarations`, the
 * same scanner the worker runs once per index.
 */
function contextOf(
  files: ReadonlyArray<{ relativePath: string; source: string }>
): ParseContext {
  return { languages: { typescript: buildTypeScriptDeclarations(files) } };
}

describe('TypeScriptAdapter — cross-file declarations (issue 18(f)2/(e))', () => {
  it('f2: a hook return type from another file types the destructured receiver', () => {
    // App.tsx:54/156 shape: `const { client } = useFixtureContext()` in WorkbenchShell, with
    // `useFixtureContext(): FixtureContextValue` and the interface both in RepoContext.tsx.
    // The call sits in a JSX attribute arrow, so it is attributed to the shell.
    const context = contextOf([
      {
        relativePath: 'src/context/RepoContext.tsx',
        source: `
interface FixtureContextValue { client: RepoQAClient; repoId: string | null }
export function useFixtureContext(): FixtureContextValue { return value; }
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
export function WorkbenchShell() {
  const { client, repoId } = useFixtureContext();
  return <TopBar onPickFolder={() => client.pickFolder()} />;
}
`,
      'src/App.tsx',
      'repo',
      context
    );
    const shell = symbols.find((symbol) => symbol.name === 'WorkbenchShell');
    const call = shell?.calls?.find((entry) => entry.method === 'pickFolder');
    expect(call?.receiverType).toBe('RepoQAClient');
    expect(call?.dynamic).toBe(false);
  });

  it('f2: the cross-file hook is reached without a rename, and resolves to the class method', () => {
    const context = contextOf([
      {
        relativePath: 'src/context/RepoContext.tsx',
        source: `
interface FixtureContextValue { client: FixtureClient }
export function useFixtureContext(): FixtureContextValue { return value; }
`
      },
      {
        relativePath: 'src/client/FixtureClient.ts',
        source: `
export class FixtureClient {
  async getSubgraphContext(repoId: string, query: string) { return {}; }
}
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
export function InspectorProvider({ children }) {
  const { client, repoId } = useFixtureContext();
  const handleCopy = async () => {
    const context = await client.getSubgraphContext(repoId, query);
    return context;
  };
  return handleCopy;
}
`,
      'src/context/InspectorContext.tsx',
      'repo',
      context
    );
    // The const arrow is its own symbol (InspectorContext.tsx:69 shape).
    const handler = symbols.find((symbol) => symbol.name === 'handleCopy');
    const call = handler?.calls?.find((entry) => entry.method === 'getSubgraphContext');
    expect(call?.receiverType).toBe('FixtureClient');
    expect(call?.dynamic).toBe(false);
  });

  it('f2 anti-false-edge: no table means no binding, and an unknown hook stays dynamic', () => {
    const source = `
export function WorkbenchShell() {
  const { client } = useFixtureContext();
  return <TopBar onPickFolder={() => client.pickFolder()} />;
}
`;
    const receiverOf = (context?: ParseContext): string | undefined =>
      parseTypeScriptSource(source, 'src/App.tsx', 'repo', context)
        .find((symbol) => symbol.name === 'WorkbenchShell')
        ?.calls?.find((entry) => entry.method === 'pickFolder')?.receiverType;

    // No context at all (the pre-increment behaviour): the receiver stays dynamic.
    expect(receiverOf()).toBeUndefined();

    // A table that knows a DIFFERENT hook must not type this one.
    const otherHook = contextOf([
      {
        relativePath: 'src/other.ts',
        source: `
interface OtherValue { client: RepoQAClient }
export function useOther(): OtherValue { return value; }
`
      }
    ]);
    expect(receiverOf(otherHook)).toBeUndefined();
  });

  it('f2 fail-closed: a hook without a return annotation binds nothing', () => {
    const context = contextOf([
      {
        relativePath: 'src/context/RepoContext.tsx',
        source: `
interface FixtureContextValue { client: RepoQAClient }
export function useFixtureContext() { return value; }
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
export function WorkbenchShell() {
  const { client } = useFixtureContext();
  return <TopBar onPickFolder={() => client.pickFolder()} />;
}
`,
      'src/App.tsx',
      'repo',
      context
    );
    const call = symbols
      .find((symbol) => symbol.name === 'WorkbenchShell')
      ?.calls?.find((entry) => entry.method === 'pickFolder');
    expect(call?.dynamic).toBe(true);
  });

  it('f2: a rename or default in the destructuring pattern binds the member name never', () => {
    // `{ client: renamed }` binds `renamed`, not `client`. Typing `client` here
    // would attach an edge to a variable that does not exist.
    const context = contextOf([
      {
        relativePath: 'src/context/RepoContext.tsx',
        source: `
interface FixtureContextValue { client: RepoQAClient }
export function useFixtureContext(): FixtureContextValue { return value; }
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
export function WorkbenchShell() {
  const { client: renamed } = useFixtureContext();
  return <TopBar onPickFolder={() => client.pickFolder()} />;
}
`,
      'src/App.tsx',
      'repo',
      context
    );
    const call = symbols
      .find((symbol) => symbol.name === 'WorkbenchShell')
      ?.calls?.find((entry) => entry.method === 'pickFolder');
    expect(call?.receiverType).toBeUndefined();
    expect(call?.dynamic).toBe(true);
  });

  it('f2 anti-false-edge: a cross-file Pick<> receiver keeps its restriction', () => {
    // The restriction has to survive the cross-file hop, or a member outside K
    // would resolve into an edge the type system does not have.
    const context = contextOf([
      {
        relativePath: 'src/context/RepoContext.tsx',
        source: `
interface FixtureContextValue { client: Pick<RepoQAClient, 'runGate'> }
export function useFixtureContext(): FixtureContextValue { return value; }
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
export function WorkbenchShell() {
  const { client } = useFixtureContext();
  return (
    <TopBar
      onRun={() => client.runGate()}
      onPick={() => client.pickFolder()}
    />
  );
}
`,
      'src/App.tsx',
      'repo',
      context
    );
    const shell = symbols.find((symbol) => symbol.name === 'WorkbenchShell');
    const allowed = shell?.calls?.find((entry) => entry.method === 'runGate');
    const outside = shell?.calls?.find((entry) => entry.method === 'pickFolder');
    expect(allowed?.receiverType).toBe('RepoQAClient');
    expect(allowed?.dynamic).toBe(false);
    expect(outside?.receiverType).toBeUndefined();
    expect(outside?.dynamic).toBe(true);
  });

  it('f2: a file-local interface shadows the cross-file one of the same name', () => {
    const context = contextOf([
      {
        relativePath: 'src/context/RepoContext.tsx',
        source: `
interface FixtureContextValue { client: OtherClient }
export function useFixtureContext(): FixtureContextValue { return value; }
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
interface FixtureContextValue { client: RepoQAClient }
export function WorkbenchShell() {
  const { client } = useFixtureContext();
  return <TopBar onPickFolder={() => client.pickFolder()} />;
}
`,
      'src/App.tsx',
      'repo',
      context
    );
    const call = symbols
      .find((symbol) => symbol.name === 'WorkbenchShell')
      ?.calls?.find((entry) => entry.method === 'pickFolder');
    expect(call?.receiverType).toBe('RepoQAClient');
  });

  it('table: the same name declared twice with different content is dropped', () => {
    const declarations: TypeScriptDeclarations = buildTypeScriptDeclarations([
      { relativePath: 'a.ts', source: `interface Shared { client: RepoQAClient }` },
      { relativePath: 'b.ts', source: `interface Shared { client: OtherClient }` },
      { relativePath: 'c.ts', source: `interface Identical { client: RepoQAClient }` },
      { relativePath: 'd.ts', source: `interface Identical { client: RepoQAClient }` }
    ]);
    // Conflicting declarations: resolving through either would be a guess.
    expect(declarations.interfaces.has('Shared')).toBe(false);
    // Identical redeclaration is harmless.
    expect(declarations.interfaces.get('Identical')?.get('client')).toBe('RepoQAClient');
  });

  it('table: a function whose two declarations disagree is dropped from both maps', () => {
    const declarations = buildTypeScriptDeclarations([
      { relativePath: 'a.ts', source: `export function useThing(): Alpha { return a; }` },
      { relativePath: 'b.ts', source: `export function useThing(): Beta { return b; }` }
    ]);
    expect(declarations.returns.has('useThing')).toBe(false);
    expect(declarations.params.has('useThing')).toBe(false);
  });

  it('e: a callback parameter is typed by the callee signature from another file', () => {
    // useReverseDeps.ts:18 shape — `(c, repoId_, name) => c.listReverseDeps(...)`
    // with the callback type declared on useSymbolResource's fourth parameter.
    const context = contextOf([
      {
        relativePath: 'src/hooks/useSymbolResource.ts',
        source: `
export function useSymbolResource<T>(
  client: RepoQAClient,
  repoId: string | null,
  symbolName: string | null,
  fetch: (client: RepoQAClient, repoId: string, symbolName: string) => Promise<T>
): SymbolResourceState<T> { return state; }
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
export function useReverseDeps(client, repoId, symbolName) {
  return useSymbolResource(client, repoId, symbolName, (c, repoId_, name) =>
    c.listReverseDeps(repoId_, name)
  );
}
`,
      'src/hooks/useReverseDeps.ts',
      'repo',
      context
    );
    const hook = symbols.find((symbol) => symbol.name === 'useReverseDeps');
    const call = hook?.calls?.find((entry) => entry.method === 'listReverseDeps');
    expect(call?.receiverType).toBe('RepoQAClient');
    expect(call?.dynamic).toBe(false);
  });

  it('e: a callback argument index is matched positionally, not by identity', () => {
    // The first version used indexOf on the argument list; lezer hands out fresh
    // SyntaxNode wrappers, so it never matched and this binding silently never
    // fired. A callback in a later position is the case that catches a regression.
    const context = contextOf([
      {
        relativePath: 'src/hooks/useThing.ts',
        source: `
export function useThing(a: A, b: B, fetch: (client: RepoQAClient) => Promise<void>) { return 1; }
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
export function consumer() {
  return useThing(first, second, (client) => client.pickFolder());
}
`,
      'src/consumer.ts',
      'repo',
      context
    );
    const call = symbols
      .find((symbol) => symbol.name === 'consumer')
      ?.calls?.find((entry) => entry.method === 'pickFolder');
    expect(call?.receiverType).toBe('RepoQAClient');
  });

  it('e anti-override: a callback parameter with its own annotation is never replaced', () => {
    // The file's own annotation wins over the callee's signature — even when it
    // does not resolve to anything the repo knows. Since issue 20 the annotation
    // DOES bind (consistent with every other parameter binding in this adapter),
    // so the invariant is asserted directly: the receiver type is the one written
    // in the file, not the one from the callee's declared signature.
    const context = contextOf([
      {
        relativePath: 'src/hooks/useThing.ts',
        source: `
export function useThing(fetch: (client: RepoQAClient) => Promise<void>) { return 1; }
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
export function consumer() {
  return useThing((c: SomethingUnresolvable) => c.pickFolder());
}
`,
      'src/consumer.ts',
      'repo',
      context
    );
    const call = symbols
      .find((symbol) => symbol.name === 'consumer')
      ?.calls?.find((entry) => entry.method === 'pickFolder');
    expect(call?.receiverType).toBe('SomethingUnresolvable');
    expect(call?.receiverType).not.toBe('RepoQAClient');
  });

  it('e fail-closed: a non-signature parameter type, an unknown callee and arity mismatch bind nothing', () => {
    const context = contextOf([
      {
        relativePath: 'src/hooks/useThing.ts',
        source: `
export function plain(fetch: RepoQAClient) { return 1; }
export function union(fetch: RepoQAClient | OtherClient) { return 1; }
export function oneParam(fetch: (client: RepoQAClient) => Promise<void>) { return 1; }
`
      }
    ]);
    const parse = (body: string): ReturnType<typeof parseTypeScriptSource> =>
      parseTypeScriptSource(body, 'src/consumer.ts', 'repo', context);
    const receiverOf = (symbols: ReturnType<typeof parseTypeScriptSource>): string | undefined =>
      symbols
        .find((symbol) => symbol.name === 'consumer')
        ?.calls?.find((entry) => entry.method === 'pickFolder')?.receiverType;

    // Not a function type at all.
    expect(receiverOf(parse(`export function consumer() { return plain((c) => c.pickFolder()); }`))).toBeUndefined();
    // A union is not a signature.
    expect(receiverOf(parse(`export function consumer() { return union((c) => c.pickFolder()); }`))).toBeUndefined();
    // A callee the table has never heard of.
    expect(receiverOf(parse(`export function consumer() { return unknownFn((c) => c.pickFolder()); }`))).toBeUndefined();
    // More parameters than the declared signature has: a shape we do not understand.
    expect(
      receiverOf(parse(`export function consumer() { return oneParam((c, extra) => c.pickFolder()); }`))
    ).toBeUndefined();
  });
});

/**
 * Issue 20 — the interface→implementation table (`implsOfInterface`) already
 * existed; what the stream family actually lacked was a TYPED RECEIVER at the
 * call site, in two shapes the adapter dropped. Both are local: neither needs
 * cross-file knowledge beyond the declaration table it already has.
 */
describe('TypeScriptAdapter — receiver typing for interface-typed streams (issue 20)', () => {
  it('a callback parameter annotated in the argument list binds (useCallback((stream: X) => …))', () => {
    // useChat.ts:180 shape. The arrow is an argument of useCallback, so it is not
    // a `const x = (…) => …` declaration and its ParamList used to be collected by
    // nobody: the annotation was right there in the file and still went unused.
    const source = `
export function useChat(client: FixtureClient) {
  const attachStream = useCallback((stream: QueryStreamLike) => {
    stream.onEvent((event) => event);
    stream.connect();
  }, []);
  return attachStream;
}
`;
    const symbols = parseTypeScriptSource(source, 'src/hooks/useChat.ts', 'repo');
    const hook = symbols.find((symbol) => symbol.name === 'useChat');
    const onEvent = hook?.calls?.find((entry) => entry.method === 'onEvent');
    const connect = hook?.calls?.find((entry) => entry.method === 'connect');
    expect(onEvent?.receiverType).toBe('QueryStreamLike');
    expect(onEvent?.dynamic).toBe(false);
    expect(connect?.receiverType).toBe('QueryStreamLike');
  });

  it('a const bound to a method call takes the method return type from the table', () => {
    // useEvolutionSession.ts:335 shape: `const stream = client.evolveStream(…)`,
    // with `evolveStream(…): EvolveStreamLike` declared in another file.
    const context = contextOf([
      {
        relativePath: 'src/client/FixtureClient.ts',
        source: `
export class FixtureClient {
  evolveStream(repoId: string, intent: string): EvolveStreamLike {
    return new EvolveStream();
  }
  private helper() { return 1; }
}
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
export function useEvolutionSession(client: FixtureClient) {
  const stream = client.evolveStream(current.id, text);
  stream.onEvent((event) => event);
  stream.connect();
  return stream;
}
`,
      'src/hooks/useEvolutionSession.ts',
      'repo',
      context
    );
    const hook = symbols.find((symbol) => symbol.name === 'useEvolutionSession');
    expect(hook?.calls?.find((entry) => entry.method === 'onEvent')?.receiverType).toBe('EvolveStreamLike');
    expect(hook?.calls?.find((entry) => entry.method === 'connect')?.receiverType).toBe('EvolveStreamLike');
  });

  it('table: method return annotations are recorded per owning type', () => {
    const declarations = buildTypeScriptDeclarations([
      {
        relativePath: 'a.ts',
        source: `
export class FixtureClient {
  evolveStream(repoId: string): EvolveStreamLike { return x; }
  async queryRepo<T>(q: string): Promise<QueryStreamLike> { return y; }
  noAnnotation(a: string) { return z; }
  private count = makeCounter(1);
}
`
      }
    ]);
    expect(declarations.methods.get('FixtureClient.evolveStream')).toBe('EvolveStreamLike');
    // `Promise<…>` is not a plain/Pick type, so it resolves to nothing later —
    // recording it raw is what keeps that decision in one place.
    expect(declarations.methods.get('FixtureClient.queryRepo')).toBe('Promise<QueryStreamLike>');
    // No annotation, and a field initializer's call is not a method.
    expect(declarations.methods.has('FixtureClient.noAnnotation')).toBe(false);
    expect(declarations.methods.has('FixtureClient.makeCounter')).toBe(false);
  });

  it('anti-false-edge: a method whose return type is not a receiver type binds nothing', () => {
    const context = contextOf([
      {
        relativePath: 'src/client/FixtureClient.ts',
        source: `
export class FixtureClient {
  queryRepo(q: string): Promise<QueryStreamLike> { return y; }
  static from(a: string): FixtureClient | null { return null; }
}
`
      }
    ]);
    const symbols = parseTypeScriptSource(
      `
export function useChat(client: FixtureClient) {
  const a = client.queryRepo('q');
  const b = FixtureClient.from('x');
  a.onEvent((event) => event);
  b.onEvent((event) => event);
  return a;
}
`,
      'src/hooks/useChat.ts',
      'repo',
      context
    );
    const hook = symbols.find((symbol) => symbol.name === 'useChat');
    const calls = (hook?.calls ?? []).filter((entry) => entry.method === 'onEvent');
    // Both receivers stay dynamic: `Promise<…>` is not a receiver type, and the
    // union return of a static factory is not one either.
    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect(call.receiverType).toBeUndefined();
      expect(call.dynamic).toBe(true);
    }
  });

  it('end to end: a unique implementation binds the interface-typed call, two do not', () => {
    const parse = (source: string): ReturnType<typeof parseTypeScriptSource> =>
      parseTypeScriptSource(source, 'src/hooks/useChat.ts', 'repo');

    // Unique implementation: the call lands on the class method.
    const single = [
      ...parse(`
export interface QueryStreamLike { onEvent(fn: () => void): void }
export class QueryStream implements QueryStreamLike {
  onEvent(fn: () => void) { return fn; }
}
`),
      ...parse(`
export function useChat(stream: QueryStreamLike) {
  return stream.onEvent(() => undefined);
}
`)
    ];
    const index = buildCallIndex(single);
    const hook = single.find((symbol) => symbol.name === 'useChat')!;
    const call = hook.calls!.find((entry) => entry.method === 'onEvent')!;
    const resolved = resolveCallEdge(index, hook, call);
    expect('target' in resolved && resolved.target.parentType).toBe('QueryStream');

    // Two implementations: nothing is deterministic, so it must NOT bind.
    const ambiguous = [
      ...parse(`
export interface QueryStreamLike { onEvent(fn: () => void): void }
export class QueryStream implements QueryStreamLike {
  onEvent(fn: () => void) { return fn; }
}
export class OtherStream implements QueryStreamLike {
  onEvent(fn: () => void) { return fn; }
}
`),
      ...parse(`
export function useChat(stream: QueryStreamLike) {
  return stream.onEvent(() => undefined);
}
`)
    ];
    const ambiguousIndex = buildCallIndex(ambiguous);
    const ambiguousHook = ambiguous.find((symbol) => symbol.name === 'useChat')!;
    const ambiguousCall = ambiguousHook.calls!.find((entry) => entry.method === 'onEvent')!;
    expect('target' in resolveCallEdge(ambiguousIndex, ambiguousHook, ambiguousCall)).toBe(false);
  });
});
