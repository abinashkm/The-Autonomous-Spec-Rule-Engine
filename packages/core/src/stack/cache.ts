import { readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StackProfile, type StackProfile as StackProfileT } from '../schemas/stack-profile.js';
import { detectStack, type DetectOptions } from './detect.js';

/**
 * Cache the StackProfile at `.specgate/stack.json`.
 *
 * Design (M1.B.6):
 *   - On write, we drop the file at `<root>/.specgate/stack.json`.
 *   - On read with `useCache: true`, we trust the file iff its `mtime` is newer
 *     than every signature-tracked file's mtime (coarse heuristic: just the
 *     top of the repo tree). We use a cheap proxy — the mtime of `package.json`
 *     / `pyproject.toml` / `go.mod` etc. when present, else the repo root.
 */

export const STACK_CACHE_RELPATH = '.specgate/stack.json';

export interface DetectWithCacheOptions extends DetectOptions {
  readonly useCache?: boolean;
}

const INDICATOR_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'pyproject.toml',
  'poetry.lock',
  'uv.lock',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
];

function latestIndicatorMtime(root: string): number {
  let latest = 0;
  for (const f of INDICATOR_FILES) {
    const p = join(root, f);
    try {
      const s = statSync(p);
      if (s.mtimeMs > latest) latest = s.mtimeMs;
    } catch {
      // ignore missing files
    }
  }
  // When no indicator files exist (e.g. the empty-git-repo fixture), do NOT
  // fall back to the root directory's mtime: writing `.specgate/` into the
  // root bumps that mtime and spuriously invalidates the cache on the next
  // `init` run (breaking M1.F.2 idempotency). An empty-indicator repo has
  // nothing meaningful to compare against — trust the cache if it exists.
  return latest;
}

export function readStackCache(root: string): StackProfileT | null {
  const abs = resolve(root, STACK_CACHE_RELPATH);
  if (!existsSync(abs)) return null;
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    return StackProfile.parse(parsed);
  } catch {
    return null;
  }
}

export function writeStackCache(root: string, profile: StackProfileT): string {
  const dir = resolve(root, '.specgate');
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, 'stack.json');
  const sorted = sortKeysDeep(profile);
  writeFileSync(abs, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  return abs;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Detect-with-cache. When `useCache` is true, returns the cached profile iff
 * the cache file is newer than every known indicator file.
 */
export async function detectStackCached(
  root: string,
  options: DetectWithCacheOptions = {},
): Promise<StackProfileT> {
  const absRoot = resolve(root);
  if (options.useCache) {
    const cached = readStackCache(absRoot);
    if (cached) {
      const cachePath = resolve(absRoot, STACK_CACHE_RELPATH);
      try {
        const cacheMtime = statSync(cachePath).mtimeMs;
        if (cacheMtime > latestIndicatorMtime(absRoot)) {
          return cached;
        }
      } catch {
        // fall through to fresh detect
      }
    }
  }
  const profile = await detectStack(absRoot, options);
  writeStackCache(absRoot, profile);
  return profile;
}
