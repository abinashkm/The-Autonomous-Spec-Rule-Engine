import { describe, expect, it } from 'vitest';
import { PackManifest } from '../../src/schemas/pack.js';

/** run.md §7.3 example turned into the JS object a YAML parser would emit. */
const RUN_MD_7_3_EXAMPLE = {
  name: 'ts-node-layered',
  version: '0.3.1',
  license: 'MIT',
  source: 'original',
  applies_to: {
    languages: ['typescript'],
    frameworks: ['express', 'nestjs'],
  },
  guidance: [
    {
      id: 'LAYER-01',
      title: 'Controllers must not access the database directly',
      body: 'Route handlers call services; services call repositories...',
      scope: { globs: ['src/**/controllers/**'], tags: ['backend'] },
      severity: 'error' as const,
    },
  ],
  checks: [
    {
      id: 'LAYER-01',
      gate: 'architecture' as const,
      engine: 'dependency-cruiser' as const,
      config: 'checks/dependency-cruiser.cjs',
      message: 'Controller imports a repository/DB module directly.',
      fix_hint: 'Move this logic into a service and call the service.',
    },
  ],
};

describe('PackManifest', () => {
  it('parses the run.md §7.3 example', () => {
    const parsed = PackManifest.parse(RUN_MD_7_3_EXAMPLE);
    expect(parsed.guidance).toHaveLength(1);
    expect(parsed.checks[0]!.engine).toBe('dependency-cruiser');
  });

  it('rejects a manifest missing license (run.md §11.4)', () => {
    const { license: _license, ...rest } = RUN_MD_7_3_EXAMPLE;
    const r = PackManifest.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.join('.') === 'license');
      expect(issue).toBeDefined();
    }
  });

  it('rejects a manifest with an empty license string (run.md §11.4)', () => {
    const r = PackManifest.safeParse({ ...RUN_MD_7_3_EXAMPLE, license: '' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.join('.') === 'license');
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/license/);
    }
  });

  it('rejects a manifest missing source', () => {
    const { source: _source, ...rest } = RUN_MD_7_3_EXAMPLE;
    const r = PackManifest.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('rejects non-semver version', () => {
    const r = PackManifest.safeParse({ ...RUN_MD_7_3_EXAMPLE, version: '0.3' });
    expect(r.success).toBe(false);
  });

  it('rejects a check with no fix hint', () => {
    const bad = structuredClone(RUN_MD_7_3_EXAMPLE);
    (bad.checks[0] as { fix_hint: string }).fix_hint = '';
    const r = PackManifest.safeParse(bad);
    expect(r.success).toBe(false);
  });
});
