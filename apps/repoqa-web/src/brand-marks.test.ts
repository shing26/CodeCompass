import { describe, expect, it } from 'vitest';
import {
  badgesEnabledFromUrl,
  brandColor,
  brandLabel,
  brandMarkSVG,
  inferBrand
} from './brand-marks';

describe('inferBrand (v0.11 Stage 2)', () => {
  it('infers Spring from Java framework annotations and kinds', () => {
    expect(inferBrand({ filePath: 'src/main/java/App.java', annotations: ['@RestController'] })).toBe(
      'spring'
    );
    expect(
      inferBrand({
        filePath: 'src/main/java/OrderService.java',
        kind: 'service',
        annotations: ['@Service']
      })
    ).toBe('spring');
    expect(
      inferBrand({ filePath: 'src/main/java/OrderRepository.java', kind: 'repository' })
    ).toBe('spring');
  });

  it('infers MyBatis from Mapper interfaces and mapper XML', () => {
    expect(
      inferBrand({ filePath: 'src/main/java/OrderMapper.java', kind: 'interface' })
    ).toBe('mybatis');
    expect(inferBrand({ filePath: 'src/main/java/OrderMapper.java', kind: 'mapper' })).toBe(
      'mybatis'
    );
    expect(
      inferBrand({ filePath: 'src/main/resources/mapper/OrderMapper.xml', name: 'OrderMapper' })
    ).toBe('mybatis');
  });

  it('infers FastAPI from Python framework hints', () => {
    expect(
      inferBrand({ filePath: 'app/main.py', annotations: ['@app.get("/items")'] })
    ).toBe('fastapi');
    expect(inferBrand({ filePath: 'services/order.py', kind: 'service' })).toBe('python');
  });

  it('infers React from TS/TSX component files and React-ish paths', () => {
    expect(inferBrand({ filePath: 'src/components/App.tsx', kind: 'class' })).toBe('react');
    expect(inferBrand({ filePath: 'src/features/order/hooks.ts', name: 'useOrders' })).toBe(
      'react'
    );
    expect(inferBrand({ filePath: 'src/api/client.ts', kind: 'method' })).toBe('typescript');
  });

  it('infers language-level brands for plain extensions', () => {
    expect(inferBrand({ filePath: 'main.go' })).toBe('go');
    expect(inferBrand({ filePath: 'query.sql', kind: 'sql' })).toBe('sql');
    expect(inferBrand({ filePath: 'component.vue' })).toBe('vue');
    expect(inferBrand({ filePath: 'Main.kt' })).toBe('kotlin');
  });

  it('returns unknown for unmatched files', () => {
    expect(inferBrand({ filePath: 'README.md' })).toBe('unknown');
    expect(inferBrand({ filePath: '' })).toBe('unknown');
  });
});

describe('brand mark helpers (v0.11 Stage 2)', () => {
  it('returns SVG markup only for known brands', () => {
    expect(brandMarkSVG('spring')).toContain('<svg');
    expect(brandMarkSVG('spring')).toContain('ccx-brand-mark');
    expect(brandMarkSVG('unknown')).toBeNull();
  });

  it('exposes stable labels and colors', () => {
    expect(brandLabel('spring')).toBe('Spring');
    expect(brandLabel('unknown')).toBe('Unknown');
    expect(brandColor('spring')).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe('badgesEnabledFromUrl (v0.11 Stage 2)', () => {
  it('enables badges by default', () => {
    expect(badgesEnabledFromUrl('')).toBe(true);
    expect(badgesEnabledFromUrl('?repo=repo-1')).toBe(true);
  });

  it('disables badges with ?badges=0', () => {
    expect(badgesEnabledFromUrl('?badges=0')).toBe(false);
    expect(badgesEnabledFromUrl('?repo=x&badges=0')).toBe(false);
  });

  it('treats unknown values as enabled', () => {
    expect(badgesEnabledFromUrl('?badges=1')).toBe(true);
  });
});
