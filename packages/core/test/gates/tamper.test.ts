import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../src/subprocess/run.js';
import { TamperGate } from '../../src/gates/tamper.js';
import { emptyStackProfile } from '../../src/schemas/stack-profile.js';
import { defaultConfig } from '../../src/config/defaults.js';
import type { RunContext } from '../../src/gates/types.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-tamper-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function initGit(cwd: string): Promise<void> {
  await run('git', ['init', '-q'], { cwd });
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd });
  await run('git', ['config', 'user.name', 'tester'], { cwd });
  await run('git', ['config', 'commit.gpgsign', 'false'], { cwd });
}

function ctx(cwd: string, overrides: Partial<RunContext> = {}): RunContext {
  const stack = emptyStackProfile(cwd, '2026-10-16T00:00:00.000Z');
  return {
    cwd,
    stack,
    config: defaultConfig(),
    scope: 'full',
    files: [],
    ...overrides,
  };
}

describe('TamperGate', () => {
  it('passes when there are no edits to protected paths', async () => {
    await initGit(tmp);
    writeFileSync(join(tmp, 'README.md'), '# hi\n', 'utf8');
    await run('git', ['add', '.'], { cwd: tmp });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: tmp });
    const result = await TamperGate.run(ctx(tmp));
    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  it('warns locally when .specgate/config.yaml is edited (no CI env)', async () => {
    await initGit(tmp);
    mkdirSync(join(tmp, '.specgate'), { recursive: true });
    writeFileSync(join(tmp, '.specgate', 'config.yaml'), 'version: 1\n', 'utf8');
    await run('git', ['add', '.'], { cwd: tmp });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: tmp });
    // Now edit the file to produce a diff vs HEAD.
    writeFileSync(
      join(tmp, '.specgate', 'config.yaml'),
      'version: 1\nstrictness: advisory\n',
      'utf8',
    );

    // Ensure CI env is OFF for this test.
    const prevCi = process.env['CI'];
    const prevGh = process.env['GITHUB_ACTIONS'];
    delete process.env['CI'];
    delete process.env['GITHUB_ACTIONS'];
    try {
      const result = await TamperGate.run(ctx(tmp));
      expect(result.status).toBe('warn');
      expect(result.blocking).toBe(false);
      expect(result.findings[0]?.severity).toBe('warning');
      expect(result.findings[0]?.file).toBe('.specgate/config.yaml');
    } finally {
      if (prevCi !== undefined) process.env['CI'] = prevCi;
      if (prevGh !== undefined) process.env['GITHUB_ACTIONS'] = prevGh;
    }
  });

  it('blocks on CI + strict when a sensitive path is edited (ADR-013)', async () => {
    await initGit(tmp);
    mkdirSync(join(tmp, '.specgate'), { recursive: true });
    writeFileSync(join(tmp, '.specgate', 'config.yaml'), 'version: 1\n', 'utf8');
    await run('git', ['add', '.'], { cwd: tmp });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: tmp });
    writeFileSync(
      join(tmp, '.specgate', 'config.yaml'),
      'version: 1\nstrictness: strict\n',
      'utf8',
    );

    const prevCi = process.env['CI'];
    process.env['CI'] = 'true';
    try {
      const c = ctx(tmp);
      c.config.strictness = 'strict';
      const result = await TamperGate.run(c);
      expect(result.status).toBe('fail');
      expect(result.blocking).toBe(true);
      expect(result.findings[0]?.severity).toBe('error');
    } finally {
      if (prevCi === undefined) delete process.env['CI'];
      else process.env['CI'] = prevCi;
    }
  });

  it('reports pass (not error) when git is not initialised (no changed files)', async () => {
    const result = await TamperGate.run(ctx(tmp));
    expect(result.status).toBe('pass');
  });
});
