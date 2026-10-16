import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Gate, GateAvailability, RepoContext, RunContext } from './types.js';
import type { Finding, GateResult } from '../schemas/gate-result.js';
import { resolveBinary, run } from '../subprocess/run.js';
import { redactLiteral } from '../subprocess/redact.js';

/**
 * Secrets gate (gitleaks wrapper).
 * Source of truth: run.md §10.2, §16 (redact findings in all outputs).
 *
 * The gate ALWAYS redacts the matched-secret payload before including the
 * finding in a result. Reports never contain the raw secret (§22.6).
 *
 * The subprocess invocation is pure argv (run.md §22.7) — gitleaks takes an
 * output file path, so we never embed user strings into shell commands.
 */

export type GitleaksFinding = {
  // Minimal subset of the gitleaks JSON schema we need. Full schema is at:
  // https://github.com/gitleaks/gitleaks
  readonly RuleID: string;
  readonly File: string;
  readonly StartLine: number;
  readonly Match?: string;
  readonly Secret?: string;
  readonly Description?: string;
};

const BUILTIN_FIX_HINT =
  'Move the value to an environment variable (gitignored .env), reference process.env.X, and rotate the key.';

/**
 * Pure normaliser — maps gitleaks JSON output to our normalised `Finding[]`.
 * Exported for recorded-output tests (M3.C.4) that run without gitleaks.
 */
export function normaliseGitleaksOutput(json: unknown): Finding[] {
  if (!Array.isArray(json)) return [];
  const out: Finding[] = [];
  for (const raw of json) {
    const g = raw as GitleaksFinding;
    if (!g || typeof g !== 'object') continue;
    const ruleId = typeof g.RuleID === 'string' ? g.RuleID : 'unknown';
    const file = typeof g.File === 'string' ? g.File : '';
    const line = Number.isFinite(g.StartLine) ? Number(g.StartLine) : null;
    const description =
      typeof g.Description === 'string' ? g.Description : 'Possible secret committed.';
    const secretText =
      typeof g.Secret === 'string' ? g.Secret : typeof g.Match === 'string' ? g.Match : '';

    // Redact: never let the secret appear in message / fix_hint.
    const safeMessage = secretText
      ? redactLiteral(description, secretText) + ' (secret redacted)'
      : description;
    const safeHint = secretText ? redactLiteral(BUILTIN_FIX_HINT, secretText) : BUILTIN_FIX_HINT;

    out.push({
      id: `gitleaks.${ruleId}`,
      severity: 'error',
      file,
      line,
      message: safeMessage,
      fix_hint: safeHint,
      auto_fixable: false,
      rule_ref: null,
      spec_ref: null,
    });
  }
  // Deterministic order: by file, then line, then rule.
  out.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if ((a.line ?? 0) !== (b.line ?? 0)) return (a.line ?? 0) - (b.line ?? 0);
    return a.id.localeCompare(b.id);
  });
  return out;
}

export const SecretsGate: Gate = {
  id: 'secrets',
  scopes: ['staged', 'full'],
  defaultBlockingAt: 'standard',

  async detect(_ctx: RepoContext): Promise<GateAvailability> {
    try {
      resolveBinary('gitleaks');
      return { available: true };
    } catch {
      return {
        available: false,
        reason:
          'gitleaks not found on PATH. Install it and re-run, or use `specgate doctor --install` once that lands (M8).',
      };
    }
  },

  async run(ctx: RunContext): Promise<GateResult> {
    const start = Date.now();
    const reportPath = join(tmpdir(), `specgate-gitleaks-${randomUUID()}.json`);
    // gitleaks: `detect --no-git --report-format json --report-path <tmp>` scans
    // the working tree. For `--staged` we add `--staged` which only reads the
    // index.
    const args = ['detect', '--no-git', '--report-format', 'json', '--report-path', reportPath];
    if (ctx.scope === 'staged') args.push('--staged');

    const result = await run('gitleaks', args, {
      cwd: ctx.cwd,
      timeoutMs: 30_000,
    });

    let findings: Finding[] = [];
    try {
      const raw = readFileSync(reportPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      findings = normaliseGitleaksOutput(parsed);
    } catch {
      // No report file (0 findings or gitleaks crashed) → leave findings empty.
    } finally {
      try {
        unlinkSync(reportPath);
      } catch {
        /* ignore */
      }
    }

    // gitleaks exits non-zero on findings; a non-zero exit WITH no report file
    // is a tool error. Everything else is a normal pass/fail.
    const toolError = result.exitCode !== 0 && findings.length === 0 && result.stderr.length > 0;
    if (toolError) {
      return {
        gate: 'secrets',
        status: 'error',
        blocking: true,
        duration_ms: Date.now() - start,
        findings: [],
        tool: { name: 'gitleaks', version: null },
        error_message: `gitleaks failed (exit ${result.exitCode}). stderr: ${result.stderr.slice(0, 400)}`,
      };
    }

    const status: GateResult['status'] = findings.length > 0 ? 'fail' : 'pass';
    return {
      gate: 'secrets',
      status,
      blocking: true,
      duration_ms: Date.now() - start,
      findings,
      tool: { name: 'gitleaks', version: null },
    };
  },
};
