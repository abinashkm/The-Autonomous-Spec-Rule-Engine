import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectStack } from '../../src/stack/detect.js';

const FIXED_NOW = () => new Date('2026-10-15T00:00:00Z');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_FIXTURES = resolve(__dirname, '..', '..', '..', '..', 'fixtures');

describe('detectStack against on-disk fixtures (M1.A)', () => {
  it('fixtures/node-express-ts matches run.md §5.1 expectations', async () => {
    const profile = await detectStack(resolve(REPO_FIXTURES, 'node-express-ts'), {
      now: FIXED_NOW,
    });
    expect(profile.languages.values).toContain('typescript');
    expect(profile.frameworks.values).toContain('express');
    expect(profile.testRunners.values).toContain('vitest');
    expect(profile.packageManagers.values).toEqual(expect.arrayContaining(['npm'])); // package.json fallback
    expect(profile.languages.confidence).toBeGreaterThan(0.8);
  });

  it('fixtures/python-fastapi matches run.md §5.1 expectations', async () => {
    const profile = await detectStack(resolve(REPO_FIXTURES, 'python-fastapi'), {
      now: FIXED_NOW,
    });
    expect(profile.languages.values).toContain('python');
    expect(profile.frameworks.values).toContain('fastapi');
    expect(profile.testRunners.values).toContain('pytest');
    expect(profile.linters.values).toContain('ruff');
  });

  it('fixtures/empty-git-repo detects nothing (low confidence on every axis)', async () => {
    const profile = await detectStack(resolve(REPO_FIXTURES, 'empty-git-repo'), {
      now: FIXED_NOW,
    });
    expect(profile.languages.values).toEqual([]);
    expect(profile.frameworks.values).toEqual([]);
    expect(profile.testRunners.values).toEqual([]);
    expect(profile.ciProvider.value).toBeNull();
  });
});
