import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normaliseGitleaksOutput, SecretsGate } from '../../src/gates/secrets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SAMPLE = resolve(__dirname, '..', 'fixtures', 'gitleaks-sample.json');

describe('normaliseGitleaksOutput (recorded-output test, M3.C.4)', () => {
  it('maps the gitleaks JSON sample to normalised Findings', () => {
    const raw = JSON.parse(readFileSync(SAMPLE, 'utf8')) as unknown;
    const findings = normaliseGitleaksOutput(raw);
    expect(findings).toHaveLength(2);
    // Deterministic order: by file, so src/aws.ts comes before src/config.js.
    expect(findings[0]!.file).toBe('src/aws.ts');
    expect(findings[0]!.id).toBe('gitleaks.aws-access-token');
    expect(findings[0]!.line).toBe(2);
    expect(findings[1]!.file).toBe('src/config.js');
    expect(findings[1]!.id).toBe('gitleaks.generic-api-key');
  });

  it('redacts the secret payload from the message and fix_hint (§22.6)', () => {
    const raw = JSON.parse(readFileSync(SAMPLE, 'utf8')) as unknown;
    const findings = normaliseGitleaksOutput(raw);
    for (const f of findings) {
      expect(f.message).not.toContain('sk-abcdefghijklmnop');
      expect(f.message).not.toContain('AKIAABCDEFGHIJKLMNOP');
      expect(f.fix_hint).not.toContain('sk-abcdefghijklmnop');
      expect(f.fix_hint).not.toContain('AKIAABCDEFGHIJKLMNOP');
    }
  });

  it('every finding has severity=error and auto_fixable=false', () => {
    const raw = JSON.parse(readFileSync(SAMPLE, 'utf8')) as unknown;
    const findings = normaliseGitleaksOutput(raw);
    for (const f of findings) {
      expect(f.severity).toBe('error');
      expect(f.auto_fixable).toBe(false);
    }
  });

  it('tolerates garbage input', () => {
    expect(normaliseGitleaksOutput(null)).toEqual([]);
    expect(normaliseGitleaksOutput({})).toEqual([]);
    expect(normaliseGitleaksOutput([{}, 'bad', null])).toEqual([
      // The empty object still emits a finding with defaults.
      expect.objectContaining({ id: 'gitleaks.unknown', file: '' }),
    ]);
  });
});

describe('SecretsGate.detect', () => {
  it('returns a skipped reason when gitleaks is not installed (default on CI)', async () => {
    // On a dev machine with gitleaks installed, this returns available:true.
    // The CI machines do not install it, so this covers the real path there.
    const r = await SecretsGate.detect({
      cwd: '/tmp',
      stack: {
        languages: { values: [], confidence: 0 },
        frameworks: { values: [], confidence: 0 },
        packageManagers: { values: [], confidence: 0 },
        testRunners: { values: [], confidence: 0 },
        linters: { values: [], confidence: 0 },
        architectureHints: { values: [], confidence: 0 },
        ciProvider: { value: null, confidence: 0 },
        rootPath: '/tmp',
        detectedAt: '2026-10-16T00:00:00.000Z',
      },
      config: {} as never,
    });
    // We allow either outcome depending on whether gitleaks is on the host.
    if (!r.available) {
      expect(r.reason).toMatch(/gitleaks|install/i);
    }
  });
});
