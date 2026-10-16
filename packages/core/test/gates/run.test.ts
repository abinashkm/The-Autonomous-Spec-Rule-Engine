import { describe, expect, it } from 'vitest';
import { runGates, runOneGate } from '../../src/gates/run.js';
import { isBlocking } from '../../src/gates/strictness.js';
import { _clearRegistry, listGates, registerGate } from '../../src/gates/registry.js';
import { ConfigSchema } from '../../src/schemas/config.js';
import { emptyStackProfile } from '../../src/schemas/stack-profile.js';
import type { Gate, GateAvailability, RepoContext, RunContext } from '../../src/gates/types.js';

function baseConfig() {
  return ConfigSchema.parse({
    version: 1,
    strictness: 'standard',
    stack: { override: {} },
    packs: [],
    gates: {
      secrets: { enabled: true, tool: 'gitleaks', blocking_at: 'standard' },
      lint: { enabled: true, command: 'auto', blocking_at: 'standard' },
      tests: { enabled: true, command: 'auto', blocking_at: 'standard' },
      coverage: { enabled: true, changed_files_min: 70, blocking_at: 'strict' },
      architecture: { enabled: true, blocking_at: 'strict' },
      dependencies: { enabled: true, tool: 'osv-scanner', blocking_at: 'strict' },
      spec: { enabled: true, require_spec_for_changes: true, blocking_at: 'strict' },
    },
    fix_loop: { max_attempts: 3 },
    context: { max_rule_tokens: 4000 },
    telemetry: 'off',
  });
}

function makeCtx(): RunContext {
  return {
    cwd: '/tmp',
    stack: emptyStackProfile('/tmp', '2026-10-16T00:00:00.000Z'),
    config: baseConfig(),
    scope: 'full',
    files: [],
  };
}

function stubGate(partial: Partial<Gate> & { id: Gate['id'] }): Gate {
  return {
    scopes: ['full'],
    defaultBlockingAt: 'standard',
    detect: async (_ctx: RepoContext): Promise<GateAvailability> => ({ available: true }),
    run: async (_ctx: RunContext) => ({
      gate: partial.id,
      status: 'pass' as const,
      blocking: true,
      duration_ms: 1,
      findings: [],
      tool: { name: partial.id, version: null },
    }),
    ...partial,
  };
}

describe('strictness truth table (3x3)', () => {
  it('is strictly ordered: advisory < standard < strict', () => {
    const expected: Record<string, boolean> = {
      // current=advisory
      'advisory,advisory': true,
      'advisory,standard': false,
      'advisory,strict': false,
      // current=standard
      'standard,advisory': true,
      'standard,standard': true,
      'standard,strict': false,
      // current=strict
      'strict,advisory': true,
      'strict,standard': true,
      'strict,strict': true,
    };
    for (const [key, want] of Object.entries(expected)) {
      const [current, gate] = key.split(',') as [
        'advisory' | 'standard' | 'strict',
        'advisory' | 'standard' | 'strict',
      ];
      expect(isBlocking(current, gate), key).toBe(want);
    }
  });
});

describe('registry', () => {
  it('listGates is sorted by id (deterministic order)', () => {
    _clearRegistry();
    registerGate(stubGate({ id: 'tests' }));
    registerGate(stubGate({ id: 'secrets' }));
    registerGate(stubGate({ id: 'lint' }));
    const ids = listGates().map((g) => g.id);
    expect(ids).toEqual(['lint', 'secrets', 'tests']);
  });
});

describe('runOneGate', () => {
  it('returns pass when the stub returns pass', async () => {
    const ctx = makeCtx();
    const result = await runOneGate(stubGate({ id: 'secrets' }), ctx);
    expect(result.status).toBe('pass');
    expect(result.gate).toBe('secrets');
    expect(result.blocking).toBe(true); // standard >= standard
  });

  it('returns skipped when detect reports unavailable', async () => {
    const ctx = makeCtx();
    const gate = stubGate({
      id: 'secrets',
      detect: async () => ({ available: false, reason: 'gitleaks not installed' }),
    });
    const result = await runOneGate(gate, ctx);
    expect(result.status).toBe('skipped');
    expect(result.skipped_reason).toContain('gitleaks');
  });

  it('returns error when run() throws', async () => {
    const ctx = makeCtx();
    const gate = stubGate({
      id: 'tests',
      run: async () => {
        throw new Error('boom');
      },
    });
    const result = await runOneGate(gate, ctx);
    expect(result.status).toBe('error');
    expect(result.error_message).toContain('boom');
  });

  it('returns error when run() exceeds the per-gate timeout', async () => {
    const ctx = makeCtx();
    const gate = stubGate({
      id: 'tests',
      run: () => new Promise(() => {}), // never resolves
    });
    const result = await runOneGate(gate, ctx, { perGateTimeoutMs: 100 });
    expect(result.status).toBe('error');
    expect(result.error_message).toContain('timed out');
  });

  it('honours `enabled: false` with a reason', async () => {
    const ctx = makeCtx();
    ctx.config.gates.tests = {
      enabled: false,
      command: 'auto',
      blocking_at: 'standard',
      reason: 'test runner intentionally disabled',
    };
    const gate = stubGate({ id: 'tests' });
    const result = await runOneGate(gate, ctx);
    expect(result.status).toBe('skipped');
    expect(result.skipped_reason).toContain('intentionally disabled');
  });

  it('config blocking_at override wins over gate.defaultBlockingAt', async () => {
    const ctx = makeCtx();
    ctx.config.gates.lint = {
      enabled: true,
      command: 'auto',
      blocking_at: 'strict', // override — advisory current → not blocking
    };
    ctx.config.strictness = 'standard';
    const gate = stubGate({ id: 'lint' });
    const result = await runOneGate(gate, ctx);
    expect(result.blocking).toBe(false);
  });
});

describe('runGates (parallel, deterministic order)', () => {
  it('returns gates sorted by id regardless of input order', async () => {
    const ctx = makeCtx();
    const gates = [
      stubGate({ id: 'tests' }),
      stubGate({ id: 'secrets' }),
      stubGate({ id: 'lint' }),
    ];
    const results = await runGates(gates, ctx);
    expect(results.map((r) => r.gate)).toEqual(['lint', 'secrets', 'tests']);
  });

  it('one failing gate does not break the others', async () => {
    const ctx = makeCtx();
    const results = await runGates(
      [
        stubGate({
          id: 'secrets',
          run: async () => {
            throw new Error('x');
          },
        }),
        stubGate({ id: 'lint' }),
      ],
      ctx,
    );
    expect(results.find((r) => r.gate === 'secrets')!.status).toBe('error');
    expect(results.find((r) => r.gate === 'lint')!.status).toBe('pass');
  });
});
