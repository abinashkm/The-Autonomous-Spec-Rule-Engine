import { delimiter, join, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { execa } from 'execa';
import { homedir } from 'node:os';

/**
 * Subprocess safety harness.
 * Source of truth: run.md §16 + §22.7.
 *
 * Rules enforced here:
 *   1. Argument arrays only. The exported `run()` type takes `string[]`; there
 *      is no overload for a single string.
 *   2. Explicit binary resolution. We refuse to shell-expand PATH; we resolve
 *      the binary ourselves via `resolveBinary`, which checks `~/.specgate/bin`
 *      and the current PATH, with Windows extension awareness.
 *   3. Timeout + output size cap.
 *   4. Env allowlist (optional). Default inherits the parent env; callers may
 *      pass an explicit `env` to lock down.
 *   5. Deterministic result shape — a `{status, exitCode, stdout, stderr, durationMs, timedOut}`
 *      object. Never throws for a non-zero exit code.
 */

export interface RunOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** Max bytes to retain from stdout + stderr each. Default 1 MB. */
  readonly maxBufferBytes?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: string;
  /** Extra lookup dirs for binaries (in addition to PATH). */
  readonly extraPathDirs?: readonly string[];
}

export interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly binary: string;
  readonly args: readonly string[];
}

export class ResolveBinaryError extends Error {
  readonly binaryName: string;
  constructor(binaryName: string, message: string) {
    super(message);
    this.name = 'ResolveBinaryError';
    this.binaryName = binaryName;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 1 * 1024 * 1024; // 1 MB

const WIN_EXT = ['.exe', '.cmd', '.bat', '.com'];

function pathDirs(options: RunOptions): string[] {
  const envPath = (options.env?.PATH ?? process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  const specgateBin = join(homedir(), '.specgate', 'bin');
  const extras = [specgateBin, ...(options.extraPathDirs ?? [])];
  return [...extras, ...envPath];
}

/** Resolve a binary name to an absolute path, honouring Windows extensions. */
export function resolveBinary(name: string, options: RunOptions = {}): string {
  // If the caller already passed an absolute path, trust it (still verify it exists).
  if (name.includes('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) {
    try {
      statSync(name);
      return name;
    } catch {
      throw new ResolveBinaryError(name, `Binary path does not exist: ${name}`);
    }
  }
  const dirs = pathDirs(options);
  const candidates: string[] = [];
  const isWin = process.platform === 'win32';
  for (const d of dirs) {
    const abs = resolve(d, name);
    candidates.push(abs);
    if (isWin) {
      for (const ext of WIN_EXT) {
        candidates.push(abs + ext);
      }
    }
  }
  for (const c of candidates) {
    try {
      const s = statSync(c);
      if (s.isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  throw new ResolveBinaryError(name, `Binary not found on PATH or in ~/.specgate/bin: ${name}`);
}

/**
 * Run a subprocess safely. The argument-array type signature makes shell
 * interpolation impossible by construction (run.md §22.7).
 */
export async function run(
  binary: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const resolved = resolveBinary(binary, options);
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER;
  const start = Date.now();
  const subprocess = execa(resolved, args as string[], {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    timeout,
    maxBuffer,
    reject: false,
    stripFinalNewline: false,
    windowsHide: true,
    stdin: options.stdin ? 'pipe' : 'ignore',
    ...(options.env ? { env: options.env } : {}),
  });
  if (options.stdin) subprocess.stdin?.write(options.stdin);
  if (options.stdin) subprocess.stdin?.end();
  const result = await subprocess;
  const durationMs = Date.now() - start;
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return {
    exitCode: result.exitCode ?? -1,
    stdout: stdout.slice(0, maxBuffer),
    stderr: stderr.slice(0, maxBuffer),
    timedOut: result.timedOut === true,
    durationMs,
    binary: resolved,
    args: [...args],
  };
}
