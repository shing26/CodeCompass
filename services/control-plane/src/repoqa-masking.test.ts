import { describe, expect, it } from 'vitest';
import {
  maskSensitiveText,
  hasSensitiveContent,
  maskEventPayload,
  MASK_PATTERNS
} from './repoqa-masking';

describe('Issue 07 masking engine — sensitive formats', () => {
  it('masks password assignments (plain, YAML, properties, .env-style)', () => {
    const text = [
      'password=supersecret',
      'spring.datasource.password: hunter2',
      'DB_PASSWORD=dbpass99',
      'db.password = prod1234',
      'passwd=admin000'
    ].join('\n');
    const masked = maskSensitiveText(text);
    expect(masked).toContain('password=***');
    expect(masked).toContain('spring.datasource.password: ***');
    expect(masked).toContain('DB_PASSWORD=***');
    expect(masked).toContain('db.password = ***');
    expect(masked).toContain('passwd=***');
    expect(masked).not.toContain('supersecret');
    expect(masked).not.toContain('hunter2');
    expect(masked).not.toContain('dbpass99');
    expect(masked).not.toContain('prod1234');
    expect(masked).not.toContain('admin000');
  });

  it('masks quoted values while preserving the quote structure', () => {
    const masked = maskSensitiveText('password = "hunter2"\napi_key=\'abc12345\'');
    expect(masked).toContain('password = "***"');
    expect(masked).toContain("api_key='***'");
    expect(masked).not.toContain('hunter2');
    expect(masked).not.toContain('abc12345');
  });

  it('masks cloud provider AK/SK assignments and access-key IDs', () => {
    const text = [
      'AK=value123',
      'SK: value456',
      'ak=LTAI1234567890abc',
      'access_key_id=AKID',
      'AccessKeySecret=eC9x2SecretValue30chars!!',
      'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'AKIA' + 'A'.repeat(16),
      'ASIA1234567890ABCDEF',
      'LTAI4ABCDEFGHIJKLMN',
      'AKIDaReallyLongTencentCloudSecretId000'
    ].join('\n');
    const masked = maskSensitiveText(text);
    expect(masked).toContain('AK=***');
    expect(masked).toContain('SK: ***');
    expect(masked).not.toContain('value123');
    expect(masked).not.toContain('value456');
    expect(masked).not.toContain('LTAI1234567890abc');
    expect(masked).not.toContain('AKID');
    expect(masked).not.toContain('eC9x2SecretValue30chars!!');
    expect(masked).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    expect(masked).not.toContain('AKIA' + 'A'.repeat(16));
    expect(masked).not.toContain('ASIA1234567890ABCDEF');
    expect(masked).not.toContain('LTAI4ABCDEFGHIJKLMN');
    expect(masked).not.toContain('aReallyLongTencentCloudSecretId000');
  });

  it('masks GitHub tokens (classic, OAuth, fine-grained)', () => {
    const text = [
      'ghp_123456789012345678901234567890123456',
      'gho_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
      'github_pat_11AAAA22BBBB3333CCCC4444DDDD55',
      'token=ghs_personalAccessToken000111222333'
    ].join('\n');
    const masked = maskSensitiveText(text);
    expect(masked).not.toContain('ghp_');
    expect(masked).not.toContain('gho_');
    expect(masked).not.toContain('github_pat_');
    expect(masked).not.toContain('ghs_');
    expect(masked).toContain('[REDACTED GITHUB TOKEN]');
  });

  it('masks OpenAI tokens (legacy and project-scoped)', () => {
    const text = [
      'sk-abcdefgh1234',
      'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'openai_api_key=sk-svcacct-1234567890ABCDEF'
    ].join('\n');
    const masked = maskSensitiveText(text);
    expect(masked).not.toContain('sk-abcdefgh1234');
    expect(masked).not.toContain('sk-proj-AAAA');
    expect(masked).not.toContain('sk-svcacct-');
    expect(masked).toContain('[REDACTED OPENAI TOKEN]');
  });

  it('masks JWTs wholly', () => {
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.abcdefghijklmnopqrstuvwxyz1234';
    const masked = maskSensitiveText(`Authorization: Bearer ${token}`);
    expect(masked).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(masked).not.toContain('abcdefghijklmnopqrstuvwxyz1234');
    expect(masked).toContain('[REDACTED JWT]');
  });

  it('masks private key blocks (PEM/PGP) entirely', () => {
    const text = [
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nAQIDBAUGBwgJ\n-----END RSA PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEI\n-----END EC PRIVATE KEY-----',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----',
      '-----BEGIN PGP PRIVATE KEY BLOCK-----\nxsFNBGE=\n-----END PGP PRIVATE KEY BLOCK-----'
    ].join('\n');
    const masked = maskSensitiveText(text);
    expect(masked).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(masked).not.toContain('MIIEowIBAAKCAQEA');
    expect(masked).not.toContain('MHcCAQEEI');
    expect(masked).not.toContain('b3BlbnNzaC1rZXktdjEAAAAA');
    expect(masked).not.toContain('BEGIN PGP PRIVATE KEY BLOCK');
    expect(masked).toContain('[REDACTED PRIVATE KEY]');
    expect(masked).toContain('[REDACTED PGP KEY]');
  });

  it('masks Bearer and Basic authorization tokens', () => {
    const masked = maskSensitiveText(
      'Authorization: Bearer some-token\nAuthorization: Basic YWRtaW46c2VjcmV0MTIz\nx-auth-token: abcdef123456'
    );
    expect(masked).toContain('Bearer ***');
    expect(masked).toContain('Basic ***');
    expect(masked).not.toContain('some-token');
    expect(masked).not.toContain('YWRtaW46c2VjcmV0MTIz');
    expect(masked).not.toContain('abcdef123456');
  });

  it('masks English copula assignments in prose', () => {
    const text = 'the default password is hunter2 and the token is abc12345';
    const masked = maskSensitiveText(text);
    expect(masked).toContain('the default password is *** and the token is ***');
    expect(masked).not.toContain('hunter2');
    expect(masked).not.toContain('abc12345');
  });

  it('reports hasSensitiveContent accurately', () => {
    expect(hasSensitiveContent('password=supersecret')).toBe(true);
    expect(hasSensitiveContent('AKIA' + 'A'.repeat(16))).toBe(true);
    expect(hasSensitiveContent('plain prose has no secrets here')).toBe(false);
    expect(hasSensitiveContent('')).toBe(false);
  });

  it('is idempotent', () => {
    const input = 'password=supersecret\ntoken: value-123\nBearer abcdef12345';
    const once = maskSensitiveText(input);
    expect(maskSensitiveText(once)).toBe(once);
  });

  it('exposes a deterministic ordered pattern catalog', () => {
    const ids = MASK_PATTERNS.map((p) => p.id);
    expect(ids).toContain('pem-private-key');
    expect(ids).toContain('jwt');
    expect(ids).toContain('github-token');
    expect(ids).toContain('openai-token');
    expect(ids).toContain('aws-access-key');
    expect(ids).toContain('aliyun-access-key');
    expect(ids).toContain('tencent-access-key');
    expect(ids).toContain('bearer-token');
    expect(ids).toContain('basic-credential');
    expect(ids).toContain('credential-assignment');
    expect(ids).toContain('env-credential-assignment');
  });
});

describe('Issue 07 masking engine — no collateral damage to code', () => {
  it('leaves function-call assignments untouched', () => {
    const text = 'const password = getPassword();\nconst token = issueToken(userId);';
    expect(maskSensitiveText(text)).toBe(text);
  });

  it('leaves member expressions untouched', () => {
    const text = 'const secret = process.env.API_KEY;\nconst ak = cfg.access;';
    expect(maskSensitiveText(text)).toBe(text);
  });

  it('leaves comparisons and arrows untouched', () => {
    const text = 'if (token === "abc") {}\nconst sk = arr.map(x => x);';
    expect(maskSensitiveText(text)).toBe(text);
  });

  it('leaves type aliases and declarations untouched', () => {
    const text = 'type Token = string;\nexport interface Password { value: string }';
    expect(maskSensitiveText(text)).toBe(text);
  });

  it('leaves template literals untouched', () => {
    const text = 'const token = `${env}_value`;';
    expect(maskSensitiveText(text)).toBe(text);
  });

  it('leaves inline maps and arrays untouched', () => {
    const text = 'config: { token: { a: 1 } }\nlist: [token, "x"]';
    expect(maskSensitiveText(text)).toBe(text);
  });

  it('leaves short sk- words and normal prose untouched', () => {
    const text =
      'build-sk-help\ntoken economy\npassword manager\nBearer policy review\nthe token is required\npassword is plain';
    expect(maskSensitiveText(text)).toBe(text);
  });

  it('keeps non-sensitive JSON and code intact', () => {
    const text = '{ "answer": "Found 3 config keys and 1 matching chunks.", "type": "done" }';
    expect(maskSensitiveText(text)).toBe(text);
  });
});

describe('Issue 07 masking engine — event payload middleware', () => {
  it('deep-masks string values in nested payloads, preserving keys', () => {
    const payload = {
      answer: 'password=supersecret',
      anchors: [{ file: 'application.yml', line: 3, symbol: 'password' }],
      counts: [1, 2],
      meta: { ok: true, note: 'token: value-123' }
    };
    const masked = maskEventPayload(payload);
    expect(masked.answer).toBe('password=***');
    expect(masked.anchors[0].file).toBe('application.yml');
    expect(masked.anchors[0].symbol).toBe('password');
    expect(masked.anchors[0].line).toBe(3);
    expect(masked.counts).toEqual([1, 2]);
    expect(masked.meta.ok).toBe(true);
    expect(masked.meta.note).toBe('token: ***');
  });

  it('returns primitives untouched', () => {
    expect(maskEventPayload(42)).toBe(42);
    expect(maskEventPayload(null)).toBe(null);
    expect(maskEventPayload(true)).toBe(true);
  });
});