import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultState,
  hashBlockingFindings,
  readState,
  resetState,
  shouldStop,
  stateFilePath,
  STATE_RELPATH,
  writeState,
} from '../../src/fixloop/state.js';
import type { GateResult } from '../../src/schemas/gate-result.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-fl-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function finding(
  partial: Partial<GateResult['findings'][number]> = {},
): GateResult['findings'][number] {
  return {
    id: 'rule-1',
    severity: 'error',
    file: 'src/a.ts',
    line: 1,
    message: 'bad',
    fix_hint: 'fix it',
    auto_fixable: false,
    rule_ref: null,
    spec_ref: null,
    ...partial,
  };
}

function result(partial: Partial<GateResult> = {}): GateResult {
  return {
    gate: 'secrets',
    status: 'fail',
    blocking: true,
    duration_ms: 0,
    findings: [finding()],
    tool: { name: 'gitleaks', version: null },
    ...partial,
  };
}

describe('state persistence', () => {
  it('readState returns defaults when the file is absent', () => {
    expect(readState(tmp)).toEqual(defaultState());
  });

  it('writeState → readState round-trips', () => {
    const s = {
      ...defaultState(),
      attempt: 2,
      lastFindingsHash: 'abc',
      updatedAt: '2026-10-16T00:00:00Z',
    };
    writeState(tmp, s);
    const read = readState(tmp);
    expect(read.attempt).toBe(2);
    expect(read.lastFindingsHash).toBe('abc');
  });

  it('corrupt state.json resets to defaults with a warning (never throws)', () => {
    mkdirSync(join(tmp, '.specgate'), { recursive: true });
    writeFileSync(join(tmp, STATE_RELPATH), '{{{not json', 'utf8');
    const s = readState(tmp);
    expect(s).toEqual(defaultState());
    // The file was rewritten with the fresh default:
    expect(existsSync(stateFilePath(tmp))).toBe(true);
  });

  it('resetState writes a clean state and returns it', () => {
    writeState(tmp, { ...defaultState(), attempt: 7, lastFindingsHash: 'x' });
    const fresh = resetState(tmp);
    expect(fresh.attempt).toBe(0);
    expect(fresh.lastFindingsHash).toBeNull();
  });
});

describe('hashBlockingFindings', () => {
  it('ignores non-blocking + skipped + pass results', () => {
    const h1 = hashBlockingFindings([result()]);
    const h2 = hashBlockingFindings([
      result(),
      result({ gate: 'lint', status: 'pass', findings: [] }),
      result({ gate: 'tests', status: 'skipped', findings: [], skipped_reason: 'tool missing' }),
    ]);
    expect(h1).toBe(h2);
  });

  it('is deterministic regardless of input order', () => {
    const a = hashBlockingFindings([
      result({
        findings: [finding({ file: 'b.ts', line: 10 }), finding({ file: 'a.ts', line: 2 })],
      }),
    ]);
    const b = hashBlockingFindings([
      result({
        findings: [finding({ file: 'a.ts', line: 2 }), finding({ file: 'b.ts', line: 10 })],
      }),
    ]);
    expect(a).toBe(b);
  });

  it('changes when a finding changes', () => {
    const before = hashBlockingFindings([result()]);
    const after = hashBlockingFindings([result({ findings: [finding({ line: 99 })] })]);
    expect(after).not.toBe(before);
  });
});

describe('shouldStop (§13.1)', () => {
  it('reason=success when there are zero blocking findings', () => {
    const v = shouldStop({
      state: defaultState(),
      maxAttempts: 3,
      results: [result({ status: 'pass', findings: [] })],
    });
    expect(v.stop).toBe(true);
    expect(v.reason).toBe('success');
  });

  it('reason=no-progress when the findings hash matches the previous attempt', () => {
    const results = [result()];
    const after1 = shouldStop({ state: defaultState(), maxAttempts: 3, results });
    expect(after1.stop).toBe(false);
    expect(after1.reason).toBeNull();
    const after2 = shouldStop({ state: after1.nextState, maxAttempts: 3, results });
    expect(after2.stop).toBe(true);
    expect(after2.reason).toBe('no-progress');
  });

  it('reason=max-attempts when attempt reaches the cap', () => {
    const v = shouldStop({
      state: { ...defaultState(), attempt: 2, lastFindingsHash: 'different' },
      maxAttempts: 3,
      results: [result()],
    });
    expect(v.stop).toBe(true);
    expect(v.reason).toBe('max-attempts');
    expect(v.nextState.attempt).toBe(3);
  });

  it('keeps running when progress is made (new hash) under the attempt cap', () => {
    const first = shouldStop({ state: defaultState(), maxAttempts: 3, results: [result()] });
    const second = shouldStop({
      state: first.nextState,
      maxAttempts: 3,
      results: [result({ findings: [finding({ line: 20 })] })], // different content → new hash
    });
    expect(second.stop).toBe(false);
    expect(second.nextState.attempt).toBe(2);
  });
});
