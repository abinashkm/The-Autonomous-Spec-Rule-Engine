import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildClaudeCodeHooks,
  buildStopFeedback,
  CLAUDE_SETTINGS_PATH,
  writeClaudeCodeHooks,
} from '../../src/hooks/claude-code.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-cc-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('buildClaudeCodeHooks', () => {
  it('exposes a PostToolUse (fast subset) and Stop (full) hook', () => {
    const spec = buildClaudeCodeHooks();
    expect(spec.hooks.PostToolUse).toBeDefined();
    expect(spec.hooks.Stop).toBeDefined();
  });

  it('PostToolUse matcher covers all file-edit tools', () => {
    const spec = buildClaudeCodeHooks();
    const entry = spec.hooks.PostToolUse![0] as { matcher: string };
    expect(entry.matcher).toContain('Edit');
    expect(entry.matcher).toContain('Write');
    expect(entry.matcher).toContain('MultiEdit');
  });
});

describe('writeClaudeCodeHooks', () => {
  it('creates .claude/settings.json when absent', () => {
    const r = writeClaudeCodeHooks(tmp);
    expect(r.action).toBe('created');
    const abs = join(tmp, CLAUDE_SETTINGS_PATH);
    expect(existsSync(abs)).toBe(true);
    const body = JSON.parse(readFileSync(abs, 'utf8')) as { hooks: Record<string, unknown> };
    expect(body.hooks.PostToolUse).toBeDefined();
    expect(body.hooks.Stop).toBeDefined();
  });

  it('merges with existing hooks and preserves user entries', () => {
    mkdirSync(join(tmp, '.claude'), { recursive: true });
    const existing = {
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'echo custom-stop' }] }],
      },
    };
    writeFileSync(join(tmp, CLAUDE_SETTINGS_PATH), JSON.stringify(existing, null, 2), 'utf8');

    const r = writeClaudeCodeHooks(tmp);
    expect(r.action).toBe('merged');

    const merged = JSON.parse(readFileSync(join(tmp, CLAUDE_SETTINGS_PATH), 'utf8')) as {
      hooks: Record<string, Array<Record<string, unknown>>>;
    };
    // User entries preserved.
    const stopCmds = merged.hooks['Stop']!.flatMap((e) =>
      (e['hooks'] as Array<Record<string, unknown>>).map((h) => h['command']),
    );
    expect(stopCmds).toContain('echo custom-stop');
    expect(stopCmds).toContain('specgate check');
  });

  it('is idempotent (second call → unchanged)', () => {
    writeClaudeCodeHooks(tmp);
    const r2 = writeClaudeCodeHooks(tmp);
    expect(r2.action).toBe('unchanged');
  });

  it('replaces its own managed entries without duplicating', () => {
    writeClaudeCodeHooks(tmp);
    writeClaudeCodeHooks(tmp);
    writeClaudeCodeHooks(tmp);
    const body = JSON.parse(readFileSync(join(tmp, CLAUDE_SETTINGS_PATH), 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    expect(body.hooks.PostToolUse!.length).toBe(1);
    expect(body.hooks.Stop!.length).toBe(1);
  });
});

describe('buildStopFeedback', () => {
  it('starts with a count line and trims the report to the byte budget', () => {
    const payload = buildStopFeedback({
      blocking: 2,
      textReport: 'x'.repeat(10_000),
      maxBytes: 1000,
    });
    expect(payload.feedback.startsWith('SpecGate: 2 blocking failure(s)')).toBe(true);
    expect(payload.feedback.length).toBeLessThanOrEqual(1000);
  });
});
