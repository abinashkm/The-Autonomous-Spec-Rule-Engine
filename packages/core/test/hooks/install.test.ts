import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectHookManager } from '../../src/hooks/detect.js';
import {
  HOOKS_RELDIR,
  installHooks,
  PRE_COMMIT_FILE,
  COMMIT_MSG_FILE,
} from '../../src/hooks/install.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-hooks-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('detectHookManager', () => {
  it('returns "none" on a clean repo', () => {
    expect(detectHookManager(tmp).manager).toBe('none');
  });

  it('detects husky via the .husky/ dir', () => {
    mkdirSync(join(tmp, '.husky'), { recursive: true });
    expect(detectHookManager(tmp).manager).toBe('husky');
  });

  it('detects husky via package.json devDependencies', () => {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ devDependencies: { husky: '^9' } }),
      'utf8',
    );
    expect(detectHookManager(tmp).manager).toBe('husky');
  });

  it('detects pre-commit via .pre-commit-config.yaml', () => {
    writeFileSync(join(tmp, '.pre-commit-config.yaml'), 'repos: []\n', 'utf8');
    expect(detectHookManager(tmp).manager).toBe('pre-commit');
  });

  it('detects lefthook via lefthook.yml', () => {
    writeFileSync(join(tmp, 'lefthook.yml'), 'pre-commit:\n', 'utf8');
    expect(detectHookManager(tmp).manager).toBe('lefthook');
  });
});

describe('installHooks (manager=none → own shims)', () => {
  it('writes a pre-commit shim and a commit-msg shim', async () => {
    const r = await installHooks({ cwd: tmp, skipGitConfig: true });
    expect(r.manager).toBe('none');
    const preCommit = join(tmp, HOOKS_RELDIR, PRE_COMMIT_FILE);
    const commitMsg = join(tmp, HOOKS_RELDIR, COMMIT_MSG_FILE);
    expect(existsSync(preCommit)).toBe(true);
    expect(existsSync(commitMsg)).toBe(true);
    const preCommitBody = readFileSync(preCommit, 'utf8');
    expect(preCommitBody).toContain('#!/usr/bin/env node');
    expect(preCommitBody).toContain('specgate');
    expect(preCommitBody).toContain('check');
    expect(preCommitBody).toContain('--staged');
    // ADR-012 "warn and skip":
    expect(preCommitBody).toContain('warn');
  });

  it('is idempotent across runs', async () => {
    await installHooks({ cwd: tmp, skipGitConfig: true });
    const preCommit = join(tmp, HOOKS_RELDIR, PRE_COMMIT_FILE);
    const first = readFileSync(preCommit, 'utf8');
    await installHooks({ cwd: tmp, skipGitConfig: true });
    const second = readFileSync(preCommit, 'utf8');
    expect(second).toBe(first);
  });
});

describe('installHooks (manager=husky → integrate, do not clobber)', () => {
  it('preserves pre-existing content and adds a managed block', async () => {
    mkdirSync(join(tmp, '.husky'), { recursive: true });
    const existing = '#!/usr/bin/env sh\n. "$(dirname -- "$0")/_/husky.sh"\n\nnpm test\n';
    writeFileSync(join(tmp, '.husky', 'pre-commit'), existing, 'utf8');

    const r = await installHooks({ cwd: tmp, skipGitConfig: true });
    expect(r.manager).toBe('husky');

    const body = readFileSync(join(tmp, '.husky', 'pre-commit'), 'utf8');
    expect(body).toContain('npm test'); // user content preserved
    expect(body).toContain('<!-- specgate:begin -->');
    expect(body).toContain('<!-- specgate:end -->');
    expect(body).toContain('specgate check --staged');
  });
});

describe('installHooks (manager=pre-commit → extend config)', () => {
  it('adds a local repo stanza inside a managed block', async () => {
    writeFileSync(
      join(tmp, '.pre-commit-config.yaml'),
      'repos:\n  - repo: https://example.com/other.git\n    hooks:\n      - id: other\n',
      'utf8',
    );
    const r = await installHooks({ cwd: tmp, skipGitConfig: true });
    expect(r.manager).toBe('pre-commit');
    const body = readFileSync(join(tmp, '.pre-commit-config.yaml'), 'utf8');
    expect(body).toContain('other.git'); // user content preserved
    expect(body).toContain('specgate check --staged');
    expect(body).toContain('<!-- specgate:begin -->');
  });
});

describe('installHooks (manager=lefthook → extend config)', () => {
  it('appends a managed block to lefthook.yml', async () => {
    writeFileSync(
      join(tmp, 'lefthook.yml'),
      'pre-commit:\n  commands:\n    other:\n      run: true\n',
      'utf8',
    );
    const r = await installHooks({ cwd: tmp, skipGitConfig: true });
    expect(r.manager).toBe('lefthook');
    const body = readFileSync(join(tmp, 'lefthook.yml'), 'utf8');
    expect(body).toContain('other:'); // user content preserved
    expect(body).toContain('specgate');
    expect(body).toContain('<!-- specgate:begin -->');
  });
});
