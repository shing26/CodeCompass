/**
 * v0.11 (Stage 2) — Technology brand marks for diagram nodes.
 *
 * Infers a tech-stack brand from a symbol's metadata and returns an inline
 * SVG badge for diagram-node injection. All marks are compact 14×14 SVGs
 * with brand-identifying colors. The fallback is 'unknown' (no mark).
 */

export type BrandId =
  | 'spring'
  | 'mybatis'
  | 'fastapi'
  | 'react'
  | 'typescript'
  | 'javascript'
  | 'go'
  | 'kotlin'
  | 'python'
  | 'sql'
  | 'vue'
  | 'unknown';

export interface BrandInput {
  filePath: string;
  kind?: string;
  name?: string;
  annotations?: string[];
}

const BRAND_COLORS: Record<BrandId, string> = {
  spring: '#6DB33F',
  mybatis: '#0EA5E9',
  fastapi: '#009688',
  react: '#61DAFB',
  typescript: '#3178C6',
  javascript: '#F7DF1E',
  go: '#00ADD8',
  kotlin: '#7F52FF',
  python: '#3776AB',
  sql: '#64748B',
  vue: '#42B883',
  unknown: '#94A3B8',
};

const BRAND_LABELS: Record<BrandId, string> = {
  spring: 'Spring',
  mybatis: 'MyBatis',
  fastapi: 'FastAPI',
  react: 'React',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  go: 'Go',
  kotlin: 'Kotlin',
  python: 'Python',
  sql: 'SQL',
  vue: 'Vue',
  unknown: 'Unknown',
};

/** Simple letter glyphs inline SVG for each brand. */
const BRAND_MARKS: Record<BrandId, string> = {
  spring: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.spring}"/><path d="M3.5 12.5c.5.5 1.3.5 1.8 0l5-5a1.3 1.3 0 0 0 0-1.8L8.5 3.8a1.3 1.3 0 0 0-1.8 0l-5 5c-.5.5-.5 1.3 0 1.8l1.8 1.8z" fill="none" stroke="#fff" stroke-width="1.2"/><path d="M7.5 3 6 5.5l1.5 1.5L6 8.5" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/></svg>`,

  mybatis: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.mybatis}"/><text x="8" y="12" text-anchor="middle" font-size="10" font-weight="700" font-family="system-ui, sans-serif" fill="#fff">M</text></svg>`,

  fastapi: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.fastapi}"/><path d="M7 3v4.5H5l4.5-6V6h2L7 13z" fill="#fff"/></svg>`,

  react: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.react}"/><circle cx="8" cy="8" r="1.5" fill="#fff"/><ellipse cx="8" cy="8" rx="5" ry="2" fill="none" stroke="#fff" stroke-width="0.8" transform="rotate(0 8 8)"/><ellipse cx="8" cy="8" rx="5" ry="2" fill="none" stroke="#fff" stroke-width="0.8" transform="rotate(60 8 8)"/><ellipse cx="8" cy="8" rx="5" ry="2" fill="none" stroke="#fff" stroke-width="0.8" transform="rotate(-60 8 8)"/></svg>`,

  typescript: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.typescript}"/><text x="8" y="12" text-anchor="middle" font-size="9" font-weight="700" font-family="system-ui, sans-serif" fill="#fff">TS</text></svg>`,

  javascript: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.javascript}"/><text x="8" y="12" text-anchor="middle" font-size="9" font-weight="700" font-family="system-ui, sans-serif" fill="#1e293b">JS</text></svg>`,

  go: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.go}"/><text x="8" y="12" text-anchor="middle" font-size="9" font-weight="700" font-family="system-ui, sans-serif" fill="#fff">Go</text></svg>`,

  kotlin: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.kotlin}"/><text x="8" y="12" text-anchor="middle" font-size="10" font-weight="700" font-family="system-ui, sans-serif" fill="#fff">K</text></svg>`,

  python: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.python}"/><text x="8" y="12" text-anchor="middle" font-size="7" font-weight="700" font-family="system-ui, sans-serif" fill="#fff">Py</text></svg>`,

  sql: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.sql}"/><ellipse cx="8" cy="5" rx="4.5" ry="1.5" fill="none" stroke="#fff" stroke-width="0.9"/><rect x="3.5" y="4.5" width="9" height="7" fill="none" stroke="#fff" stroke-width="0.9"/><path d="M3.5 5.5v6a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5v-6" fill="none" stroke="#fff" stroke-width="0.9"/></svg>`,

  vue: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.vue}"/><path d="M8 3L3 13h10L8 3z" fill="none" stroke="#fff" stroke-width="1.2"/><path d="M8 5.5L5.5 11h5L8 5.5z" fill="#fff"/></svg>`,

  unknown: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="ccx-brand-mark"><rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="${BRAND_COLORS.unknown}"/><text x="8" y="12" text-anchor="middle" font-size="10" font-weight="700" font-family="system-ui, sans-serif" fill="#fff">?</text></svg>`,
};

/**
 * Infer the technology brand of a symbol from its file path, kind, and
 * annotations. Returns 'unknown' when no brand is confidently identified.
 */
export function inferBrand(input: BrandInput): BrandId {
  const ext = input.filePath.split('.').pop()?.toLowerCase() ?? '';
  const name = input.name ?? '';
  const kind = input.kind ?? '';
  const annotations = input.annotations ?? [];
  const baseName = input.filePath.split(/[\\/]/).pop() ?? '';

  if (ext === 'sql' || kind === 'sql') return 'sql';

  if (ext === 'java') {
    if (
      kind === 'mapper' ||
      name.endsWith('Mapper') ||
      baseName.endsWith('Mapper.java') ||
      annotations.some(a => a.includes('Mapper'))
    ) {
      return 'mybatis';
    }
    // Non-Mapper Java symbols are Spring by default (controllers/services/repos).
    return 'spring';
  }

  if (ext === 'kt' || ext === 'kts') {
    if (annotations.some(a => a.startsWith('@'))) return 'spring';
    return 'kotlin';
  }

  if (ext === 'py') {
    const fastapiAnnotations = [
      'fastapi', 'FastAPI', 'APIRouter', '@app.get', '@app.post',
      '@app.put', '@app.delete', '@app.route'
    ];
    if (
      annotations.some(a => fastapiAnnotations.some(f => a.includes(f))) ||
      name.includes('fastapi') || name.includes('FastAPI') ||
      input.filePath.includes('fastapi') || input.filePath.includes('main.py')
    ) {
      return 'fastapi';
    }
    return 'python';
  }

  if (ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts') {
    if (
      kind === 'route' || annotations.some(a => /react/i.test(a)) ||
      name.startsWith('use') || name.startsWith('React') || name.startsWith('react') ||
      input.filePath.includes('react') || input.filePath.includes('component')
    ) {
      return 'react';
    }
    return 'typescript';
  }

  if (ext === 'js' || ext === 'jsx' || ext === 'mjs') {
    if (
      kind === 'route' || annotations.some(a => /react/i.test(a)) ||
      input.filePath.includes('react') || input.filePath.includes('component')
    ) {
      return 'react';
    }
    return 'javascript';
  }

  if (ext === 'go') return 'go';
  if (ext === 'vue') return 'vue';

  if (
    ext === 'xml' &&
    (name.toLowerCase().includes('mapper') || kind === 'mapper' ||
      input.filePath.toLowerCase().includes('mapper'))
  ) {
    return 'mybatis';
  }

  return 'unknown';
}

/**
 * Get the inline SVG markup for a brand.
 * Returns null for 'unknown' to avoid rendering a question-mark badge.
 */
export function brandMarkSVG(brand: BrandId): string | null {
  if (brand === 'unknown') return null;
  return BRAND_MARKS[brand] ?? null;
}

/** Human-readable brand label. */
export function brandLabel(brand: BrandId): string {
  return BRAND_LABELS[brand] ?? brand;
}

export function brandColor(brand: BrandId): string {
  return BRAND_COLORS[brand] ?? BRAND_COLORS.unknown;
}

/**
 * Check whether query-string badges are enabled (`?badges=0` disables them).
 */
export function badgesEnabledFromUrl(search: string = ''): boolean {
  try {
    const params =
      typeof search === 'string' && search !== ''
        ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
        : new URLSearchParams(window.location.search);
    return params.get('badges') !== '0';
  } catch {
    return true;
  }
}
