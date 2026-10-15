import { describe, expect, it } from 'vitest';
import {
  AgentsBlockBudgetError,
  MAX_AGENTS_MD_LINES,
  estimateTokens,
  renderAgentsBlock,
} from '../../src/agents-md/render.js';
import { ConfigSchema } from '../../src/schemas/config.js';
import { emptyStackProfile } from '../../src/schemas/stack-profile.js';
import { SIDE_CARS } from '../../src/agents-md/side-cars.js';

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

function baseProfile() {
  const p = emptyStackProfile('/repo', '2026-10-15T00:00:00.000Z');
  return {
    ...p,
    languages: { values: ['typescript'], confidence: 0.9 },
    frameworks: { values: ['express'], confidence: 0.9 },
    testRunners: { values: ['vitest'], confidence: 0.9 },
    packageManagers: { values: ['pnpm'], confidence: 1 },
    linters: { values: ['eslint'], confidence: 1 },
  };
}

describe('renderAgentsBlock', () => {
  it('contains the workflow-contract commands (specgate context + specgate check)', () => {
    const body = renderAgentsBlock(baseProfile(), baseConfig());
    expect(body).toContain('specgate context');
    expect(body).toContain('specgate check');
  });

  it('stays under the 150-line budget (run.md §9.1)', () => {
    const body = renderAgentsBlock(baseProfile(), baseConfig());
    const lines = body.split('\n').length;
    expect(lines).toBeLessThanOrEqual(MAX_AGENTS_MD_LINES);
  });

  it('throws if a padded profile would exceed the token budget', () => {
    const padded = baseProfile();
    const longList = Array.from({ length: 500 }, (_, i) => `fw-${i}`);
    padded.frameworks = { values: longList, confidence: 1 };
    expect(() => renderAgentsBlock(padded, baseConfig(), { maxTokens: 400 })).toThrow(
      AgentsBlockBudgetError,
    );
  });

  it('renders the stack summary from the profile', () => {
    const body = renderAgentsBlock(baseProfile(), baseConfig());
    expect(body).toContain('`typescript`');
    expect(body).toContain('`express`');
    expect(body).toContain('`vitest`');
  });

  it('mentions the enabled gates from the config', () => {
    const body = renderAgentsBlock(baseProfile(), baseConfig());
    expect(body).toContain('`secrets`');
    expect(body).toContain('`lint`');
    expect(body).toContain('`tests`');
  });

  it('estimateTokens is non-negative and monotonic', () => {
    expect(estimateTokens('')).toBeGreaterThanOrEqual(0);
    expect(estimateTokens('hello world')).toBeGreaterThan(estimateTokens('hi'));
  });

  it('matches the committed snapshot (golden test)', () => {
    const body = renderAgentsBlock(baseProfile(), baseConfig());
    expect(body).toMatchSnapshot();
  });
});

describe('SIDE_CARS', () => {
  it('provides pointers for CLAUDE.md, Cursor, Copilot, Gemini', () => {
    const paths = SIDE_CARS.map((s) => s.path);
    expect(paths).toContain('CLAUDE.md');
    expect(paths).toContain('GEMINI.md');
    expect(paths.some((p) => p.startsWith('.cursor/'))).toBe(true);
    expect(paths.some((p) => p.includes('copilot'))).toBe(true);
  });

  it('each side-car is a short pointer (<10 lines, mentions AGENTS.md)', () => {
    for (const sc of SIDE_CARS) {
      const nonBlank = sc.body.split('\n').filter((l) => l.trim().length > 0).length;
      expect(nonBlank).toBeLessThan(10);
      expect(sc.body).toContain('AGENTS.md');
    }
  });
});
