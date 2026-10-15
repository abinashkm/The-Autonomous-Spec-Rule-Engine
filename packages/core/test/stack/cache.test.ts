import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectStackCached,
  readStackCache,
  writeStackCache,
  STACK_CACHE_RELPATH,
} from '../../src/stack/cache.js';
import * as detectModule from '../../src/stack/detect.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'specgate-cache-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeAt(rel: string, body = ''): void {
  const abs = join(tmpRoot, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

describe('stack cache', () => {
  it('writeStackCache + readStackCache round-trip', async () => {
    writeAt('package.json', JSON.stringify({}));
    const profile = await detectModule.detectStack(tmpRoot);
    const written = writeStackCache(tmpRoot, profile);
    expect(existsSync(written)).toBe(true);
    const read = readStackCache(tmpRoot);
    expect(read).toEqual(profile);
  });

  it('returns null on a missing cache', () => {
    expect(readStackCache(tmpRoot)).toBeNull();
  });

  it('returns null on a corrupt cache', () => {
    mkdirSync(join(tmpRoot, '.specgate'), { recursive: true });
    writeFileSync(join(tmpRoot, STACK_CACHE_RELPATH), '{{{not json', 'utf8');
    expect(readStackCache(tmpRoot)).toBeNull();
  });

  it('detectStackCached writes the cache and reuses it when fresh', async () => {
    writeAt('package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    writeAt('tsconfig.json', '{}');

    // First call: cold cache. Detect runs.
    const spy = vi.spyOn(detectModule, 'detectStack');
    const first = await detectStackCached(tmpRoot, { useCache: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.frameworks.values).toContain('express');

    // Bump the cache mtime so it's newer than indicator files.
    const cachePath = join(tmpRoot, STACK_CACHE_RELPATH);
    const future = new Date(Date.now() + 60_000);
    utimesSync(cachePath, future, future);

    // Second call: cache hit, detect should NOT re-run.
    const second = await detectStackCached(tmpRoot, { useCache: true });
    expect(spy).toHaveBeenCalledTimes(1); // still 1
    expect(second).toEqual(first);
  });
});
