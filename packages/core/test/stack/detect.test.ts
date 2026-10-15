import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyStackOverride, detectStack, globMatch } from '../../src/stack/detect.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'specgate-stack-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeAt(rel: string, body = ''): void {
  const abs = join(tmpRoot, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

const FIXED_NOW = () => new Date('2026-10-15T00:00:00Z');

describe('globMatch', () => {
  it('matches exact segments', () => {
    expect(globMatch('package.json', 'package.json')).toBe(true);
    expect(globMatch('package.json', 'other.json')).toBe(false);
  });

  it('matches `*` within a segment', () => {
    expect(globMatch('**/*.csproj', 'src/App.csproj')).toBe(true);
    expect(globMatch('**/*.csproj', 'App.csproj')).toBe(true);
    expect(globMatch('**/*.ts', 'src/a/b.ts')).toBe(true);
  });

  it('matches `**` across arbitrary depth', () => {
    expect(globMatch('.github/workflows/*.yml', '.github/workflows/ci.yml')).toBe(true);
    expect(globMatch('src/**/*.ts', 'src/server.ts')).toBe(true);
    expect(globMatch('src/**/*.ts', 'src/a/b/c.ts')).toBe(true);
    expect(globMatch('src/**/*.ts', 'app/main.ts')).toBe(false);
  });
});

describe('detectStack', () => {
  it('returns an empty profile with low confidence on a bare repo', async () => {
    writeAt('README.md', '# empty');
    const profile = await detectStack(tmpRoot, { now: FIXED_NOW });
    expect(profile.languages.values).toEqual([]);
    expect(profile.languages.confidence).toBe(0);
    expect(profile.rootPath).toContain('specgate-stack-');
    expect(profile.detectedAt).toBe('2026-10-15T00:00:00.000Z');
  });

  it('detects Node + TypeScript + Express + vitest + pnpm from the fixture tree', async () => {
    writeAt(
      'package.json',
      JSON.stringify({
        name: 'app',
        dependencies: { express: '^4' },
        devDependencies: { typescript: '^5', vitest: '^2' },
      }),
    );
    writeAt('tsconfig.json', '{}');
    writeAt('pnpm-lock.yaml', '');
    writeAt('src/server.ts', 'export const x = 1;');

    const profile = await detectStack(tmpRoot, { now: FIXED_NOW });
    expect(profile.languages.values).toContain('typescript');
    expect(profile.languages.values).toContain('javascript');
    expect(profile.frameworks.values).toContain('express');
    expect(profile.testRunners.values).toContain('vitest');
    expect(profile.packageManagers.values).toContain('pnpm');
    expect(profile.languages.confidence).toBeGreaterThan(0.8);
  });

  it('detects Python + FastAPI + pytest + ruff from the fixture tree', async () => {
    writeAt(
      'pyproject.toml',
      [
        '[project]',
        'name = "app"',
        'dependencies = ["fastapi>=0.110"]',
        '',
        '[tool.pytest.ini_options]',
        'testpaths = ["tests"]',
        '',
        '[tool.ruff]',
        'line-length = 100',
      ].join('\n'),
    );
    writeAt('app/main.py', 'from fastapi import FastAPI');

    const profile = await detectStack(tmpRoot, { now: FIXED_NOW });
    expect(profile.languages.values).toContain('python');
    expect(profile.frameworks.values).toContain('fastapi');
    expect(profile.testRunners.values).toContain('pytest');
    expect(profile.linters.values).toContain('ruff');
    expect(profile.languages.confidence).toBeGreaterThan(0.8);
  });

  it('returns both Python and Node for a mixed repo (confidence > 0.5 on each)', async () => {
    writeAt('package.json', JSON.stringify({ dependencies: {} }));
    writeAt('tsconfig.json', '{}');
    writeAt('pyproject.toml', '[project]\nname = "x"');
    writeAt('src/a.ts', '');

    const profile = await detectStack(tmpRoot, { now: FIXED_NOW });
    expect(profile.languages.values).toContain('typescript');
    expect(profile.languages.values).toContain('python');
    expect(profile.languages.confidence).toBeGreaterThan(0.5);
  });

  it('respects user override: override.languages = ["go"] on a Node repo wins', async () => {
    writeAt('package.json', JSON.stringify({}));
    writeAt('tsconfig.json', '{}');
    const detected = await detectStack(tmpRoot, { now: FIXED_NOW });
    expect(detected.languages.values).toContain('typescript');

    const overridden = applyStackOverride(detected, { languages: ['go'] });
    expect(overridden.languages.values).toEqual(['go']);
    expect(overridden.languages.confidence).toBe(1);
  });

  it('detects GitHub Actions CI provider from a workflow file', async () => {
    writeAt('.github/workflows/ci.yml', 'name: ci\n');
    const profile = await detectStack(tmpRoot, { now: FIXED_NOW });
    expect(profile.ciProvider.value).toBe('github-actions');
    expect(profile.ciProvider.confidence).toBe(1);
  });

  it('throws when path does not exist', async () => {
    await expect(detectStack(join(tmpRoot, 'does-not-exist'), { now: FIXED_NOW })).rejects.toThrow(
      /path does not exist/,
    );
  });
});
