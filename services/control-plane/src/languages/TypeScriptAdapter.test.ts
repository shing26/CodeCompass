import { describe, expect, it } from 'vitest';
import { TypeScriptAdapter, parseTypeScriptSource } from './TypeScriptAdapter';

describe('TypeScriptAdapter — symbol extraction (Issue 25)', () => {
  it('recognizes TS files and extracts plain class/function/interface/type symbols', () => {
    expect(TypeScriptAdapter.canParse('src/app.ts')).toBe(true);
    expect(TypeScriptAdapter.canParse('src/app.tsx')).toBe(true);
    expect(TypeScriptAdapter.canParse('src/app.js')).toBe(true);
    expect(TypeScriptAdapter.canParse('src/app.jsx')).toBe(true);
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
});
