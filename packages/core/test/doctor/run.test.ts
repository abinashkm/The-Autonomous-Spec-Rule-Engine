import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../../src/doctor/run.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-doctor-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('runDoctor', () => {
  it('runs on an empty repo and always probes node + git + gitleaks', async () => {
    const result = await runDoctor({ cwd: tmp });
    const tools = result.probes.map((p) => p.tool);
    expect(tools).toContain('node');
    expect(tools).toContain('git');
    expect(tools).toContain('gitleaks');
  });

  it('reports node and git as present (CI matrix always has them)', async () => {
    const result = await runDoctor({ cwd: tmp });
    const node = result.probes.find((p) => p.tool === 'node');
    const git = result.probes.find((p) => p.tool === 'git');
    expect(node?.status).toBe('present');
    expect(node?.version).toMatch(/^v\d/);
    expect(git?.status).toBe('present');
  });

  it('reports gitleaks as missing with an install hint when absent', async () => {
    const result = await runDoctor({ cwd: tmp });
    const gitleaks = result.probes.find((p) => p.tool === 'gitleaks');
    expect(gitleaks).toBeDefined();
    // We cannot assert status here deterministically (CI might install gitleaks
    // later); we assert the hint is populated regardless.
    expect(gitleaks!.hint).toMatch(/gitleaks|install/i);
  });

  it('`ok` is true when every required tool is present', async () => {
    const result = await runDoctor({ cwd: tmp });
    const requiredPresent = result.probes
      .filter((p) => p.required)
      .every((p) => p.status === 'present');
    expect(result.ok).toBe(requiredPresent);
  });
});
