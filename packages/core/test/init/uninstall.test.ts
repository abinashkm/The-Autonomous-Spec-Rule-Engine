import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../../src/init/run.js';
import { runUninstall } from '../../src/init/uninstall.js';
import { writeClaudeCodeHooks } from '../../src/hooks/claude-code.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_FIXTURES = resolve(__dirname, '..', '..', '..', '..', 'fixtures');

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-uninstall-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function copyFixture(name: string): string {
  const dest = join(tmp, name);
  cpSync(resolve(REPO_FIXTURES, name), dest, { recursive: true });
  return dest;
}

function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(dir: string): void {
    for (const ent of readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })) {
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

describe('runUninstall', () => {
  it('(DoD) init → uninstall --purge leaves the repo byte-identical to the pre-init state', async () => {
    const cwd = copyFixture('node-express-ts');
    const before = snapshotTree(cwd);
    await runInit({ cwd });
    const after = snapshotTree(cwd);
    expect(after).not.toEqual(before); // sanity: init did something
    await runUninstall({ cwd, purge: true, skipGitConfig: true });
    const final = snapshotTree(cwd);
    expect(final).toEqual(before);
  });

  it('without --purge: deletes stack/state/.gitignore but preserves user content under .specgate/', async () => {
    const cwd = copyFixture('node-express-ts');
    await runInit({ cwd });
    // Pretend the user wrote some content; it must survive uninstall.
    writeFileSync(join(cwd, '.specgate', 'notes.md'), '# human notes\n', 'utf8');

    await runUninstall({ cwd, skipGitConfig: true });

    expect(existsSync(join(cwd, '.specgate', 'stack.json'))).toBe(false);
    expect(existsSync(join(cwd, '.specgate', '.gitignore'))).toBe(false);
    expect(existsSync(join(cwd, '.specgate', 'notes.md'))).toBe(true);
    expect(existsSync(join(cwd, '.specgate', 'config.yaml'))).toBe(true); // user may want to keep
  });

  it('preserves user-authored content around managed blocks in AGENTS.md', async () => {
    const cwd = copyFixture('node-express-ts');
    const agentsPath = join(cwd, 'AGENTS.md');
    const userPrefix = '# My AGENTS.md\n\nI wrote this.\n\n';
    writeFileSync(agentsPath, userPrefix, 'utf8');
    await runInit({ cwd });
    expect(readFileSync(agentsPath, 'utf8')).toContain('I wrote this.');
    await runUninstall({ cwd, purge: true, skipGitConfig: true });
    const after = readFileSync(agentsPath, 'utf8');
    expect(after).toContain('I wrote this.');
    expect(after).not.toContain('<!-- specgate:begin -->');
  });

  it('removes managed Claude Code hooks but preserves user hooks around them', async () => {
    const cwd = copyFixture('node-express-ts');
    const settingsPath = join(cwd, '.claude', 'settings.json');
    // Seed a user hook that must survive.
    cpSync(join(cwd, 'package.json'), join(cwd, 'package.json.bak'));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify(
        { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep-me' }] }] } },
        null,
        2,
      ),
      'utf8',
    );
    writeClaudeCodeHooks(cwd);

    await runUninstall({ cwd, skipGitConfig: true });

    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks?: Record<string, Array<Record<string, unknown>>>;
    };
    const stopCmds =
      (after.hooks?.['Stop'] ?? []).flatMap((e) =>
        (e['hooks'] as Array<Record<string, unknown>>).map((h) => h['command']),
      ) ?? [];
    expect(stopCmds).toContain('echo keep-me');
    // Our managed Stop hook ran `specgate check`; it must now be gone.
    expect(stopCmds).not.toContain('specgate check');
  });

  it('reports absent targets without erroring on an empty repo', async () => {
    const r = await runUninstall({ cwd: tmp, skipGitConfig: true });
    const kinds = new Set(r.actions.map((a) => a.action));
    expect(kinds.has('absent')).toBe(true);
    // No action should throw / be `skipped` here (except possibly git config).
  });
});
