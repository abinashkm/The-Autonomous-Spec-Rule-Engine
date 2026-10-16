import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Claude Code hook adapter.
 * Source of truth: run.md §9.3 + §22.
 *
 * We write a `.claude/settings.json` fragment that wires two SpecGate hooks:
 *   - PostToolUse (file-edit tools): run the fast subset check — only
 *     `--gate secrets` plus the lint subset on changed files. Non-blocking
 *     feedback.
 *   - Stop: run `specgate check` fully; if it reports blocking failures,
 *     block the model from stopping and feed back the fix prompt. The full
 *     prompt builder is M5 (M5.B); in M4 we feed back the terminal report.
 *
 * The write is managed-block-aware (`<!-- specgate:begin --> ... end -->`)
 * since users may have their own Claude Code hooks around it.
 */

export interface ClaudeCodeHookSpec {
  /** Hook spec objects to merge into .claude/settings.json. */
  readonly hooks: {
    readonly PostToolUse?: readonly unknown[];
    readonly Stop?: readonly unknown[];
  };
}

export const CLAUDE_SETTINGS_PATH = '.claude/settings.json';

export function buildClaudeCodeHooks(): ClaudeCodeHookSpec {
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit|NotebookEdit',
          hooks: [
            {
              type: 'command',
              command: 'specgate check --changed --gate secrets',
              timeout: 20,
              _specgateManaged: true,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: 'specgate check',
              timeout: 180,
              // In M5 this will emit a structured feedback payload with the
              // generated fix prompt. For M4 the stdout IS the feedback.
              _specgateManaged: true,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Idempotent writer for `.claude/settings.json`. We overwrite only the
 * `_specgateManaged: true` entries; user-added hooks around ours are preserved.
 */
export function writeClaudeCodeHooks(cwd: string): {
  readonly path: string;
  readonly action: 'created' | 'merged' | 'unchanged';
} {
  const absDir = resolve(cwd, dirname(CLAUDE_SETTINGS_PATH));
  const abs = resolve(cwd, CLAUDE_SETTINGS_PATH);
  mkdirSync(absDir, { recursive: true });

  const spec = buildClaudeCodeHooks();

  if (!existsSync(abs)) {
    writeFileSync(abs, JSON.stringify(spec, null, 2) + '\n', 'utf8');
    return { path: abs, action: 'created' };
  }

  const current = JSON.parse(readFileSync(abs, 'utf8')) as {
    hooks?: Record<string, unknown[]>;
  };
  current.hooks = current.hooks ?? {};

  for (const [name, newEntries] of Object.entries(spec.hooks)) {
    const existing = current.hooks[name] ?? [];
    const preserved = existing.filter((e: unknown) => !isSpecgateManaged(e));
    current.hooks[name] = [...preserved, ...(newEntries ?? [])];
  }

  const serialized = JSON.stringify(current, null, 2) + '\n';
  const previous = readFileSync(abs, 'utf8');
  if (serialized === previous) return { path: abs, action: 'unchanged' };
  writeFileSync(abs, serialized, 'utf8');
  return { path: abs, action: 'merged' };
}

function isSpecgateManaged(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as { hooks?: Array<Record<string, unknown>> };
  const hs = e.hooks ?? [];
  return hs.some((h) => h && typeof h === 'object' && h['_specgateManaged'] === true);
}

/**
 * Build the feedback blob returned to Claude Code's Stop hook when gates
 * fail. In M4 we return a short plain-text summary; M5 upgrades this to the
 * full correction-prompt payload.
 */
export function buildStopFeedback(options: {
  readonly blocking: number;
  readonly textReport: string;
  readonly maxBytes?: number;
}): { readonly feedback: string } {
  const header = `SpecGate: ${options.blocking} blocking failure(s). Fix the items below, then re-run.\n\n`;
  const trimmed = options.textReport.slice(0, (options.maxBytes ?? 4000) - header.length);
  return { feedback: header + trimmed };
}

/** JSON Schema for the settings fragment (vendored manually for M4; the
 *  full Claude Code schema will land in schemas/vendored/ in M6 when the
 *  MCP + plugin work gates it). */
export const CLAUDE_CODE_SETTINGS_FRAGMENT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ClaudeCodeSettingsFragment',
  type: 'object',
  properties: {
    hooks: {
      type: 'object',
      additionalProperties: false,
      properties: {
        PostToolUse: { type: 'array', items: { type: 'object' } },
        Stop: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  required: ['hooks'],
} as const;
