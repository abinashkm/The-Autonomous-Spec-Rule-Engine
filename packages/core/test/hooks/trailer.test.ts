import { describe, expect, it } from 'vitest';
import { parseTrailer, validateCommitMessage } from '../../src/hooks/trailer.js';
import { ConfigSchema, type Config } from '../../src/schemas/config.js';

function cfg(strictness: 'advisory' | 'standard' | 'strict'): Config {
  return ConfigSchema.parse({
    version: 1,
    strictness,
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

describe('parseTrailer', () => {
  it('extracts REQ, T, AC ids from a Spec: trailer line', () => {
    const msg = 'commit title\n\nbody\n\nSpec: REQ-001, T-002, AC-001.1\n';
    expect(parseTrailer(msg).ids.sort()).toEqual(['AC-001.1', 'REQ-001', 'T-002']);
  });

  it('returns [] when no trailer is present', () => {
    expect(parseTrailer('nothing special here').ids).toEqual([]);
  });
});

describe('validateCommitMessage', () => {
  it('ok when there are no active specs regardless of trailer', () => {
    const r = validateCommitMessage({
      cwd: '/tmp',
      message: 'no trailer',
      config: cfg('standard'),
      activeSpecIds: [],
    });
    expect(r.ok).toBe(true);
  });

  it('blocks on standard when active specs exist and no trailer is present', () => {
    const r = validateCommitMessage({
      cwd: '/tmp',
      message: 'no trailer',
      config: cfg('standard'),
      activeSpecIds: ['SPEC-001'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.severity).toBe('block');
  });

  it('warns (does not block) on advisory', () => {
    const r = validateCommitMessage({
      cwd: '/tmp',
      message: 'no trailer',
      config: cfg('advisory'),
      activeSpecIds: ['SPEC-001'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.severity).toBe('warn');
  });

  it('passes on standard when a trailer with any id is present', () => {
    const r = validateCommitMessage({
      cwd: '/tmp',
      message: 'title\n\nSpec: REQ-001\n',
      config: cfg('standard'),
      activeSpecIds: ['SPEC-001'],
    });
    expect(r.ok).toBe(true);
  });
});
