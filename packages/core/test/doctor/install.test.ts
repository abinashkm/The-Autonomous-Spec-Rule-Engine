import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPinnedTools, type InstallToolsOptions } from '../../src/doctor/install.js';
import { PINNED_TOOLS } from '../../src/doctor/pinned.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-install-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mockFetch(payload: Buffer): InstallToolsOptions['fetchFn'] {
  return async () => ({
    ok: true,
    status: 200,
    body: Readable.from([payload]) as unknown as NodeJS.ReadableStream,
  });
}

describe('installPinnedTools', () => {
  it('does nothing without consent (ADR-015 requires explicit opt-in)', async () => {
    const r = await installPinnedTools({ consent: false, binDir: tmp });
    expect(r.actions.every((a) => a.action === 'skipped')).toBe(true);
    expect(r.actions.length).toBeGreaterThan(0);
    expect(r.actions[0]!.note).toMatch(/consent/i);
  });

  it('refuses to download when the pinned digest is still the release-pipeline placeholder', async () => {
    const r = await installPinnedTools({ consent: true, binDir: tmp });
    // Every entry today still carries a PLACEHOLDER_ sha256 string.
    const outcomes = new Set(r.actions.map((a) => a.action));
    expect(outcomes.has('placeholder-digest')).toBe(true);
    expect(r.actions.some((a) => a.action === 'installed')).toBe(false);
    // Nothing was written to disk.
    for (const a of r.actions) if (a.target) expect(existsSync(a.target)).toBe(false);
  });

  it('installs a bare binary when the SHA-256 matches (uses a mocked fetch)', async () => {
    // Pick an entry we can target without archive handling: osv-scanner for
    // the current platform.
    const payload = Buffer.from('fake-binary\n');
    const digest = createHash('sha256').update(payload).digest('hex');

    // Patch PINNED_TOOLS in-place for this test: swap osv-scanner's placeholder
    // for the real digest of our fake payload.
    const osv = PINNED_TOOLS.find((t) => t.tool === 'osv-scanner')!;
    const platforms = Object.keys(osv.downloads) as Array<keyof typeof osv.downloads>;
    const originals: Record<string, string> = {};
    for (const p of platforms) {
      originals[p] = osv.downloads[p]!.sha256;
      (osv.downloads[p] as { sha256: string }).sha256 = digest;
    }

    try {
      const r = await installPinnedTools({
        consent: true,
        binDir: tmp,
        tools: ['osv-scanner'],
        fetchFn: mockFetch(payload),
      });
      const installed = r.actions.find((a) => a.action === 'installed');
      expect(installed).toBeDefined();
      expect(existsSync(installed!.target)).toBe(true);
      expect(readFileSync(installed!.target).toString()).toBe('fake-binary\n');
    } finally {
      for (const p of platforms) {
        (osv.downloads[p] as { sha256: string }).sha256 = originals[p]!;
      }
    }
  });

  it('rejects downloads whose checksum does not match the pin', async () => {
    const payload = Buffer.from('fake-binary-A');
    const bogus = createHash('sha256').update(Buffer.from('something-else')).digest('hex');

    const osv = PINNED_TOOLS.find((t) => t.tool === 'osv-scanner')!;
    const platforms = Object.keys(osv.downloads) as Array<keyof typeof osv.downloads>;
    const originals: Record<string, string> = {};
    for (const p of platforms) {
      originals[p] = osv.downloads[p]!.sha256;
      (osv.downloads[p] as { sha256: string }).sha256 = bogus;
    }

    try {
      const r = await installPinnedTools({
        consent: true,
        binDir: tmp,
        tools: ['osv-scanner'],
        fetchFn: mockFetch(payload),
      });
      const err = r.actions.find((a) => a.action === 'error');
      expect(err?.note).toMatch(/checksum mismatch/i);
      // No binary should remain on disk.
      for (const a of r.actions) if (a.target) expect(existsSync(a.target)).toBe(false);
    } finally {
      for (const p of platforms) {
        (osv.downloads[p] as { sha256: string }).sha256 = originals[p]!;
      }
    }
  });

  it('dryRun lists the plan without touching disk', async () => {
    const r = await installPinnedTools({ consent: true, binDir: tmp, dryRun: true });
    expect(
      r.actions.every((a) => a.action === 'skipped' || a.action === 'placeholder-digest'),
    ).toBe(true);
  });
});
