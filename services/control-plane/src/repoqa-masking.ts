/**
 * Issue 07 — Multi-pattern sensitive information masking engine.
 *
 * Each pattern is deterministic over plain text and is applied in order.
 * Patterns that rewrite credential assignments reconstruct valid syntax
 * (quoted values keep their quotes; `type X = string`, member expressions,
 * function calls and comparisons are left untouched) so normal code is never
 * collaterally damaged.
 */

export interface MaskPattern {
  id: string;
  description: string;
  /** Regular expression, applied with the global flag by the engine. */
  re: RegExp;
  /** Replacement string (may use capture group refs) or callback. */
  replacement: string | ((match: string, ...groups: string[]) => string);
}

/**
 * Decide how to mask a credential value captured by an assignment pattern.
 * Returns the replacement text or `null` when the assignment is actually
 * procedural code (function call, member expression, template, type alias,
 * header keyword, comparison) that must be left untouched.
 */
function maskAssignmentValue(
  key: string,
  sep: string,
  dq: string | undefined,
  sq: string | undefined,
  raw: string | undefined,
  before: string,
  after: string
): string | null {
  const value = dq ?? sq ?? raw ?? '';
  const lower = value.toLowerCase();

  // Auth header keywords carry their token separately (Bearer/Basic patterns).
  if (lower === 'bearer' || lower === 'basic') return null;
  // Template literals and interpolation must not be rewritten.
  if (value.startsWith('$')) return null;
  if (value.startsWith('`')) return null;
  // Member expressions (`process.env.API_KEY`, `cfg.secret`) are references.
  if (value.includes('.')) return null;
  // Function calls: `password = getPassword()` is code, not a literal.
  if (after === '(') return null;
  // Type aliases: `type Token = string`.
  if (!dq && !sq && /(?:\b|_)type\s*$/.test(before)) return null;

  if (dq !== undefined) return `${key}${sep}"***"`;
  if (sq !== undefined) return `${key}${sep}'***'`;
  return `${key}${sep}***`;
}

const KEY_ALTERNATION = [
  // Specific credential key names first so `\b` anchors resolve correctly.
  'aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key)',
  'access[_-]?key[_-]?id',
  'access[_-]?key[_-]?secret',
  'secret[_-]?access[_-]?key',
  'secret[_-]?key',
  'secret[_-]?token',
  'access[_-]?key',
  'access[_-]?token',
  'client[_-]?secret',
  'app[_-]?secret',
  'app[_-]?token',
  'auth[_-]?token',
  'api[_-]?key',
  'apikey',
  'private[_-]?key',
  'refresh[_-]?token',
  'id[_-]?token',
  'session[_-]?token',
  'db[_-]?password',
  'x-api-key',
  'x-auth-token',
  'authorization',
  'credential',
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'ak',
  'sk'
].join('|');

/** UPPER_SNAKE environment keys: `DB_PASSWORD`, `GITHUB_TOKEN`, ... */
const ENV_SUFFIX_ALTERNATION = [
  'PASSWORD',
  'PASSWD',
  'PRIVATE[_-]?KEY',
  'CLIENT[_-]?SECRET',
  'REFRESH[_-]?TOKEN',
  'AUTH[_-]?TOKEN',
  'ACCESS[_-]?KEY(?:_ID)?',
  'API[_-]?KEY',
  'SECRET',
  'TOKEN',
  'KEY'
].join('|');

export const MASK_PATTERNS: MaskPattern[] = [
  {
    id: 'pem-private-key',
    description: 'PEM private key blocks (RSA/EC/OPENSSH/ENCRYPTED).',
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED PRIVATE KEY]'
  },
  {
    id: 'pgp-private-key',
    description: 'PGP private key blocks.',
    re: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
    replacement: '[REDACTED PGP KEY]'
  },
  {
    id: 'jwt',
    description: 'JSON Web Tokens (three base64url segments).',
    re: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    replacement: '[REDACTED JWT]'
  },
  {
    id: 'github-token',
    description: 'GitHub classic PAT / OAuth / fine-grained tokens.',
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: '[REDACTED GITHUB TOKEN]'
  },
  {
    id: 'openai-token',
    description: 'OpenAI `sk-` API keys (legacy and project-scoped).',
    re: /\bsk-(?:proj-|admin-|srv-)?[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED OPENAI TOKEN]'
  },
  {
    id: 'aws-access-key',
    description: 'AWS access key IDs and temporary credentials.',
    re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g,
    replacement: '[REDACTED AWS KEY]'
  },
  {
    id: 'aliyun-access-key',
    description: 'Alibaba Cloud AccessKey IDs.',
    re: /\bLTAI[A-Za-z0-9]{12,}\b/g,
    replacement: '[REDACTED ALIYUN KEY]'
  },
  {
    id: 'tencent-access-key',
    description: 'Tencent Cloud SecretId-style keys.',
    re: /\bAKID[A-Za-z0-9]{13,}\b/g,
    replacement: '[REDACTED TENCENT KEY]'
  },
  {
    id: 'bearer-token',
    description: 'Bearer authorization tokens.',
    re: /(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/g,
    replacement: '$1***'
  },
  {
    id: 'basic-credential',
    description: 'Basic authorization base64 credentials.',
    re: /(\bBasic\s+)[A-Za-z0-9+/=]{8,}\b/g,
    replacement: '$1***'
  },
  {
    id: 'credential-assignment',
    description:
      'Key-value assignments for common credential key names. Values may be ' +
      'quoted (quotes preserved) or unquoted literal-like tokens.',
    re: new RegExp(
      `(\\b(?:${KEY_ALTERNATION})\\b)` +
        `(\\s*[:=](?![=>])\\s*)` +
        `(?:"((?:[^"\\\\]|\\\\.){0,300})"|'((?:[^'\\\\]|\\\\.){0,300})'|([^\\s,;"'()\\[\\]{}]+))`,
      'gi'
    ),
    replacement: (
      match: string,
      key: string,
      sep: string,
      dq: string,
      sq: string,
      raw: string,
      offset: string,
      input: string
    ) => {
      const before = input.slice(0, Number(offset));
      const after = input[Number(offset) + match.length] ?? '';
      const result = maskAssignmentValue(key, sep, dq, sq, raw, before, after);
      return result ?? match;
    }
  },
  {
    id: 'credential-is-copula',
    description:
      'English copula assignments in prose ("the password is hunter2"). ' +
      'Only token-like values (digit or symbol) are masked so ordinary ' +
      'sentences like "the token is required" survive untouched.',
    re: new RegExp(
      `(\\b(?:${KEY_ALTERNATION})\\b)(\\s+is\\s+)([^\\s,.;"'()\\[\\]{}]{2,})`,
      'gi'
    ),
    replacement: (
      match: string,
      key: string,
      sep: string,
      value: string,
      offset: string,
      input: string
    ) => {
      if (!/[0-9]|[-_./+=]/.test(value)) return match;
      const before = input.slice(0, Number(offset));
      const after = input[Number(offset) + match.length] ?? '';
      if (after === '(') return match;
      if (value.startsWith('`') || value.startsWith('$')) return match;
      if (/(?:\b|_)type\s*$/.test(before)) return match;
      return `${key}${sep}***`;
    }
  },
  {
    id: 'env-credential-assignment',
    description:
      'UPPER_SNAKE environment variables ending in credential suffixes ' +
      '(`DB_PASSWORD=...`, `GITHUB_TOKEN=...`, `AWS_ACCESS_KEY_ID=...`).',
    re: new RegExp(
      `(\\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_)` +
        `((?:${ENV_SUFFIX_ALTERNATION}))\\b` +
        `(\\s*[:=](?![=>])\\s*)` +
        `(?:"((?:[^"\\\\]|\\\\.){0,300})"|'((?:[^'\\\\]|\\\\.){0,300})'|([^\\s,;"'()\\[\\]{}]+))`,
      'g'
    ),
    replacement: (
      match: string,
      envPrefix: string,
      suffix: string,
      sep: string,
      dq: string,
      sq: string,
      raw: string,
      offset: string,
      input: string
    ) => {
      const before = input.slice(0, Number(offset));
      const after = input[Number(offset) + match.length] ?? '';
      const result = maskAssignmentValue(envPrefix + suffix, sep, dq, sq, raw, before, after);
      return result ?? match;
    }
  }
];

export function maskSensitiveText(input: string): string {
  let output = input;
  for (const pattern of MASK_PATTERNS) {
    if (typeof pattern.replacement === 'string') {
      output = output.replace(pattern.re, pattern.replacement);
    } else {
      output = output.replace(pattern.re, pattern.replacement as (...args: any[]) => string);
    }
  }
  return output;
}

export function hasSensitiveContent(input: string): boolean {
  return maskSensitiveText(input) !== input;
}

/**
 * Deep-walk a JSON-ish payload and mask every string value. Object keys are
 * left untouched so event schemas and symbol names survive intact.
 */
export function maskEventPayload<T>(payload: T): T {
  if (typeof payload === 'string') {
    return maskSensitiveText(payload) as unknown as T;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => maskEventPayload(item)) as unknown as T;
  }
  if (payload !== null && typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      out[key] = maskEventPayload(value);
    }
    return out as unknown as T;
  }
  return payload;
}