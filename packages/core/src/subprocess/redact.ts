/**
 * Secret redaction for tool output rendered in reports / logs / fix prompts.
 * Source of truth: run.md §16 "Secrets in reports: gitleaks findings are
 * redacted in all outputs (show rule + file + line, never the secret)".
 *
 * Design: a short library of built-in patterns + an extensible API for gates
 * to add their own (gitleaks emits the exact match string on the finding, so
 * the secrets gate ALSO redacts the raw match).
 */

export interface RedactPattern {
  readonly name: string;
  readonly re: RegExp;
}

const BUILTIN: readonly RedactPattern[] = [
  // Generic API-key / token prefixes.
  { name: 'openai', re: /\bsk-[A-Za-z0-9]{10,}\b/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  // Private-key markers.
  {
    name: 'private-key',
    re: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
  },
];

export function redact(input: string, extra: readonly RedactPattern[] = []): string {
  let out = input;
  for (const p of [...BUILTIN, ...extra]) {
    out = out.replace(p.re, '***REDACTED***');
  }
  return out;
}

/** Convenience: redact a known literal secret string (used by secrets gate
 *  when gitleaks hands us the exact match on a finding). */
export function redactLiteral(input: string, secret: string): string {
  if (secret.length < 4) return input;
  // Replace all occurrences without using RegExp (safer with special chars).
  return input.split(secret).join('***REDACTED***');
}
