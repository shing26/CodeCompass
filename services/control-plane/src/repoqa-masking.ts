export function maskSensitiveText(input: string): string {
  let output = input;
  output = output.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]'
  );
  output = output.replace(
    /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/g,
    '$1***'
  );
  output = output.replace(
    /\b(api[_-]?key|apikey|access[_-]?key|secret[_-]?key|password|passwd|token)\b(\s*[:=]\s*)([^\s,;"')\]}]+)/gi,
    '$1$2***'
  );
  output = output.replace(
    /\b(secret[_-]?access[_-]?key|access[_-]?key[_-]?id|client[_-]?secret|app[_-]?secret)\b(\s*[:=]\s*)([^\s,;"')\]}]+)/gi,
    '$1$2***'
  );
  output = output.replace(
    /\b(ak|sk)\b(\s*[:=]\s*)([^\s,;"')\]}]+)/gi,
    '$1$2***'
  );
  output = output.replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '***');
  output = output.replace(/\bsk-[A-Za-z0-9_-]{4,}\b/g, '***');
  return output;
}
