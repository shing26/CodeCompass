import { describe, expect, it } from 'vitest';
import { PythonAdapter, parsePythonSource } from './PythonAdapter';

describe('PythonAdapter — symbol extraction (Issue 27)', () => {
  it('recognizes .py files and extracts class/def/async def symbols with line numbers', () => {
    expect(PythonAdapter.canParse('app/main.py')).toBe(true);
    expect(PythonAdapter.canParse('app/main.go')).toBe(false);

    const source = [
      'class Pet:',
      '    pass',
      '',
      'class OwnerService:',
      '    def __init__(self, repo: Repository):',
      '        self.repo = repo',
      '',
      '    async def find_one(self, owner_id: int):',
      '        return await self.repo.find_by_id(owner_id)',
      '',
      'def main():',
      '    service = OwnerService(repo=None)',
      '    return service.find_one(1)'
    ].join('\n');
    const symbols = parsePythonSource(source, 'app/service.py', 'repo');

    const pet = symbols.find((symbol) => symbol.name === 'Pet');
    expect(pet?.kind).toBe('class');
    expect(pet?.lineStart).toBe(1);

    const service = symbols.find((symbol) => symbol.name === 'OwnerService');
    expect(service?.kind).toBe('service');
    expect(service?.lineStart).toBe(4);

    const init = symbols.find((symbol) => symbol.name === '__init__');
    expect(init).toMatchObject({
      kind: 'method',
      parentType: 'OwnerService',
      lineStart: 5
    });

    const field = symbols.find((symbol) => symbol.name === 'repo');
    expect(field).toMatchObject({
      kind: 'field',
      parentType: 'OwnerService',
      type: 'Repository',
      lineStart: 6
    });

    const findOne = symbols.find((symbol) => symbol.name === 'find_one');
    expect(findOne).toMatchObject({
      kind: 'method',
      parentType: 'OwnerService',
      lineStart: 8
    });
    expect(findOne?.calls?.[0]).toMatchObject({
      method: 'find_by_id',
      receiver: 'repo',
      receiverType: 'Repository',
      dynamic: false
    });

    const main = symbols.find((symbol) => symbol.name === 'main');
    expect(main?.lineStart).toBe(11);
    expect(main?.calls?.[0]).toMatchObject({
      method: 'find_one',
      receiver: 'service',
      receiverType: 'OwnerService',
      dynamic: false
    });
  });

  it('extracts FastAPI routes with APIRouter prefix', () => {
    const source = [
      'from fastapi import FastAPI',
      'from fastapi.routing import APIRouter',
      '',
      'app = FastAPI()',
      'router = APIRouter(prefix="/api")',
      '',
      '@app.get("/owners")',
      'async def list_owners():',
      '    return []',
      '',
      '@router.post("/owners")',
      'def create_owner():',
      '    return {}'
    ].join('\n');
    const symbols = parsePythonSource(source, 'app/routes.py', 'repo');

    const getRoute = symbols.find((symbol) => symbol.name === 'GET /owners');
    expect(getRoute).toMatchObject({
      kind: 'route',
      displayPath: '/owners',
      lineStart: 7
    });
    expect(getRoute?.calls?.[0]?.method).toBe('list_owners');

    const listOwners = symbols.find((symbol) => symbol.name === 'list_owners');
    expect(listOwners?.displayPath).toBe('/owners');

    const postRoute = symbols.find((symbol) => symbol.name === 'POST /api/owners');
    expect(postRoute?.displayPath).toBe('/api/owners');
    expect(postRoute?.calls?.[0]?.method).toBe('create_owner');

    const createOwner = symbols.find((symbol) => symbol.name === 'create_owner');
    expect(createOwner?.displayPath).toBe('/api/owners');
  });

  it('extracts Flask route decorators', () => {
    const source = [
      'from flask import Flask',
      '',
      'flask_app = Flask(__name__)',
      '',
      '@flask_app.route("/health")',
      'def health():',
      '    return "ok"'
    ].join('\n');
    const symbols = parsePythonSource(source, 'app/web.py', 'repo');

    const route = symbols.find((symbol) => symbol.name === 'route /health');
    expect(route?.kind).toBe('route');
    expect(route?.displayPath).toBe('/health');
    expect(route?.calls?.[0]?.method).toBe('health');

    const handler = symbols.find((symbol) => symbol.name === 'health');
    expect(handler?.displayPath).toBe('/health');
  });

  it('supports include_router prefix cascade, add_api_route and Flask methods (v0.6.0)', () => {
    const source = [
      'from fastapi import FastAPI',
      'from fastapi.routing import APIRouter',
      '',
      'app = FastAPI()',
      'router = APIRouter()',
      'app.include_router(router, prefix="/api/v1")',
      '',
      '@router.get("/items")',
      'def list_items():',
      '    return []',
      '',
      'app.add_api_route("/health", handler, methods=["GET", "POST"])',
      '',
      'from flask import Flask',
      'flask_app = Flask(__name__)',
      '',
      '@flask_app.route("/admin", methods=["GET", "POST"])',
      'def admin():',
      '    return "ok"'
    ].join('\n');
    const symbols = parsePythonSource(source, 'app/routes.py', 'repo');

    expect(
      symbols.find((symbol) => symbol.name === 'GET /api/v1/items')
    ).toMatchObject({
      kind: 'route',
      displayPath: '/api/v1/items'
    });
    expect(
      symbols.find((symbol) => symbol.name === 'GET /health')
    ).toMatchObject({
      kind: 'route',
      displayPath: '/health'
    });
    expect(
      symbols.find((symbol) => symbol.name === 'POST /health')
    ).toMatchObject({
      kind: 'route',
      displayPath: '/health'
    });
    expect(
      symbols.find((symbol) => symbol.name === 'GET /admin')
    ).toMatchObject({
      kind: 'route',
      displayPath: '/admin'
    });
    expect(
      symbols.find((symbol) => symbol.name === 'POST /admin')
    ).toMatchObject({
      kind: 'route',
      displayPath: '/admin'
    });
  });
});
