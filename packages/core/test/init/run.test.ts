import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../../src/init/run.js';
import { BEGIN, END } from '../../src/managed-block/markers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_FIXTURES = resolve(__dirname, '..', '..', '..', '..', 'fixtures');

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-init-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function copyFixture(name: string): string {
  const dest = join(tmp, name);
  cpSync(resolve(REPO_FIXTURES, name), dest, { recursive: true });
  return dest;
}

/** Deep snapshot of a directory (relative path → file bytes). */
function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(dir: string): void {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) {
        const rel = abs
          .slice(root.length + 1)
          .split('\\')
          .join('/');
        out[rel] = readFileSync(abs, 'utf8');
      }
    }
  }
  walk(root);
  return out;
}

describe('runInit', () => {
  it('creates config, AGENTS.md block, stack.json, and .specgate/.gitignore on a bare fixture', async () => {
    const cwd = copyFixture('node-express-ts');
    const result = await runInit({ cwd });
    expect(result.stack.frameworks.values).toContain('express');

    // 1. Config file written
    const cfgText = readFileSync(join(cwd, '.specgate', 'config.yaml'), 'utf8');
    expect(cfgText).toContain('strictness: standard');

    // 2. stack.json cached
    expect(statSync(join(cwd, '.specgate', 'stack.json')).size).toBeGreaterThan(0);

    // 3. AGENTS.md has a managed block
    const agents = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    expect(agents).toContain(BEGIN);
    expect(agents).toContain(END);
    expect(agents).toContain('specgate check');

    // 4. .specgate/.gitignore present
    const sgIgnore = readFileSync(join(cwd, '.specgate', '.gitignore'), 'utf8');
    expect(sgIgnore).toContain('reports/');
    expect(sgIgnore).toContain('state.json');
  });

  it('(M1.F.2) running init twice produces a byte-identical tree (idempotency)', async () => {
    const cwd = copyFixture('node-express-ts');
    await runInit({ cwd });
    const first = snapshotTree(cwd);
    await runInit({ cwd });
    const second = snapshotTree(cwd);
    expect(second).toEqual(first);
  });

  it('(M1.F.3) preserves user content above and below markers in AGENTS.md', async () => {
    const cwd = copyFixture('node-express-ts');
    const agentsPath = join(cwd, 'AGENTS.md');
    const userBefore = '# Project agent notes\n\nUser wrote this first.\n\n';
    const userAfter = '\n\n## Appendix (user)\n\nKeep this intact.\n';
    // Pre-seed AGENTS.md with user content WITHOUT markers.
    writeFileSync(agentsPath, userBefore + userAfter, 'utf8');

    await runInit({ cwd });

    const text = readFileSync(agentsPath, 'utf8');
    expect(text).toContain(userBefore);
    expect(text).toContain(userAfter);
    expect(text).toContain(BEGIN);
    expect(text).toContain(END);
    // The block must have been appended, not replaced the user content.
    const beginIdx = text.indexOf(BEGIN);
    const userBeforeIdx = text.indexOf(userBefore);
    expect(userBeforeIdx).toBeLessThan(beginIdx);
  });

  it('(M1.F.3) replaces only the managed region on re-run if the user edits around it', async () => {
    const cwd = copyFixture('node-express-ts');
    await runInit({ cwd });
    const agentsPath = join(cwd, 'AGENTS.md');
    const original = readFileSync(agentsPath, 'utf8');

    // User adds content around the block.
    const userPrefix = '# My prefix\n\n';
    const userSuffix = '\n\n## My suffix\n';
    writeFileSync(agentsPath, userPrefix + original + userSuffix, 'utf8');

    await runInit({ cwd });

    const after = readFileSync(agentsPath, 'utf8');
    expect(after.startsWith(userPrefix)).toBe(true);
    expect(after.endsWith(userSuffix)).toBe(true);
    // Still contains the managed block.
    expect(after).toContain(BEGIN);
    expect(after).toContain(END);
  });

  it('skips overwriting an existing .specgate/config.yaml (reports "skipped")', async () => {
    const cwd = copyFixture('node-express-ts');
    mkdirSync(join(cwd, '.specgate'), { recursive: true });
    const customCfg = ['version: 1', 'strictness: advisory'].join('\n');
    // Minimal but incomplete — we are only testing the "already exists" branch.
    writeFileSync(join(cwd, '.specgate', 'config.yaml'), customCfg, 'utf8');

    const result = await runInit({ cwd });
    const action = result.actions.find((a) => a.target === '.specgate/config.yaml');
    expect(action?.action).toBe('skipped');

    const text = readFileSync(join(cwd, '.specgate', 'config.yaml'), 'utf8');
    expect(text).toBe(customCfg);
  });

  it('works on the empty-git-repo fixture (nothing to detect, still creates files)', async () => {
    const cwd = copyFixture('empty-git-repo');
    const result = await runInit({ cwd });
    expect(result.stack.languages.values).toEqual([]);
    expect(statSync(join(cwd, 'AGENTS.md')).size).toBeGreaterThan(0);
    expect(statSync(join(cwd, '.specgate', 'config.yaml')).size).toBeGreaterThan(0);
  });

  it('works on the python-fastapi fixture', async () => {
    const cwd = copyFixture('python-fastapi');
    const result = await runInit({ cwd });
    expect(result.stack.frameworks.values).toContain('fastapi');
    const agents = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('`fastapi`');
  });
});
