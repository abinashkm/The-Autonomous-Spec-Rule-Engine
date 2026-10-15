/**
 * Stack signature table — the authoritative list of file patterns and content
 * probes the stack detector uses.
 *
 * Source of truth: run.md §5.1.
 *
 * Design notes:
 *   - Each signature targets ONE axis of the StackProfile (language, framework,
 *     package manager, test runner, linter, CI provider).
 *   - `filePattern` is a repo-root-relative glob; `contentProbe` runs ONLY when
 *     the file matches, and must be cheap (regex, no parsing).
 *   - No network, ever (run.md §16 local-first).
 */

export type StackAxis =
  'languages' | 'frameworks' | 'packageManagers' | 'testRunners' | 'linters' | 'ciProvider';

export interface Signature {
  readonly id: string;
  readonly axis: StackAxis;
  readonly value: string;
  /** Repo-root-relative path or glob. We implement a cheap glob (M1.B.2) that
   *  supports `*` segments and `**` for recursive descent. */
  readonly filePattern: string;
  /** When present, the file matched by `filePattern` must also match this regex. */
  readonly contentProbe?: RegExp;
  /** 0.1 (weak hint) .. 1.0 (definitive). Multiple matches on the same axis
   *  increase overall confidence (clamped to 1). */
  readonly weight: number;
}

export const SIGNATURES: readonly Signature[] = [
  // --- languages --------------------------------------------------------
  {
    id: 'lang.ts.tsconfig',
    axis: 'languages',
    value: 'typescript',
    filePattern: 'tsconfig.json',
    weight: 0.9,
  },
  {
    id: 'lang.ts.file',
    axis: 'languages',
    value: 'typescript',
    filePattern: 'src/**/*.ts',
    weight: 0.6,
  },
  {
    id: 'lang.js.pkg',
    axis: 'languages',
    value: 'javascript',
    filePattern: 'package.json',
    weight: 0.5,
  },
  {
    id: 'lang.py.pyproject',
    axis: 'languages',
    value: 'python',
    filePattern: 'pyproject.toml',
    weight: 0.9,
  },
  { id: 'lang.py.setup', axis: 'languages', value: 'python', filePattern: 'setup.py', weight: 0.7 },
  {
    id: 'lang.py.reqs',
    axis: 'languages',
    value: 'python',
    filePattern: 'requirements.txt',
    weight: 0.6,
  },
  {
    id: 'lang.py.file',
    axis: 'languages',
    value: 'python',
    filePattern: 'src/**/*.py',
    weight: 0.4,
  },
  { id: 'lang.go.mod', axis: 'languages', value: 'go', filePattern: 'go.mod', weight: 1.0 },
  { id: 'lang.java.pom', axis: 'languages', value: 'java', filePattern: 'pom.xml', weight: 1.0 },
  {
    id: 'lang.java.gradle',
    axis: 'languages',
    value: 'java',
    filePattern: 'build.gradle',
    weight: 0.9,
  },
  {
    id: 'lang.java.gradle.kts',
    axis: 'languages',
    value: 'java',
    filePattern: 'build.gradle.kts',
    weight: 0.9,
  },
  {
    id: 'lang.cs.csproj',
    axis: 'languages',
    value: 'csharp',
    filePattern: '**/*.csproj',
    weight: 1.0,
  },
  {
    id: 'lang.rust.cargo',
    axis: 'languages',
    value: 'rust',
    filePattern: 'Cargo.toml',
    weight: 1.0,
  },

  // --- frameworks (JS/TS) ----------------------------------------------
  {
    id: 'fw.express',
    axis: 'frameworks',
    value: 'express',
    filePattern: 'package.json',
    contentProbe: /"express"\s*:/,
    weight: 0.9,
  },
  {
    id: 'fw.nestjs',
    axis: 'frameworks',
    value: 'nestjs',
    filePattern: 'nest-cli.json',
    weight: 1.0,
  },
  {
    id: 'fw.nestjs.pkg',
    axis: 'frameworks',
    value: 'nestjs',
    filePattern: 'package.json',
    contentProbe: /"@nestjs\/core"\s*:/,
    weight: 0.9,
  },
  {
    id: 'fw.next',
    axis: 'frameworks',
    value: 'nextjs',
    filePattern: 'next.config.js',
    weight: 1.0,
  },
  {
    id: 'fw.next.ts',
    axis: 'frameworks',
    value: 'nextjs',
    filePattern: 'next.config.ts',
    weight: 1.0,
  },
  {
    id: 'fw.next.mjs',
    axis: 'frameworks',
    value: 'nextjs',
    filePattern: 'next.config.mjs',
    weight: 1.0,
  },

  // --- frameworks (Python) ---------------------------------------------
  {
    id: 'fw.fastapi',
    axis: 'frameworks',
    value: 'fastapi',
    filePattern: 'pyproject.toml',
    contentProbe: /\bfastapi\b/,
    weight: 0.9,
  },
  {
    id: 'fw.django.manage',
    axis: 'frameworks',
    value: 'django',
    filePattern: 'manage.py',
    weight: 1.0,
  },
  {
    id: 'fw.django.pyproject',
    axis: 'frameworks',
    value: 'django',
    filePattern: 'pyproject.toml',
    contentProbe: /\bdjango\b/,
    weight: 0.9,
  },

  // --- package managers (JS/TS) ----------------------------------------
  {
    id: 'pm.pnpm',
    axis: 'packageManagers',
    value: 'pnpm',
    filePattern: 'pnpm-lock.yaml',
    weight: 1.0,
  },
  { id: 'pm.yarn', axis: 'packageManagers', value: 'yarn', filePattern: 'yarn.lock', weight: 1.0 },
  {
    id: 'pm.npm',
    axis: 'packageManagers',
    value: 'npm',
    filePattern: 'package-lock.json',
    weight: 1.0,
  },
  { id: 'pm.bun', axis: 'packageManagers', value: 'bun', filePattern: 'bun.lockb', weight: 1.0 },
  // Fallback: a package.json with no lockfile still implies npm family.
  {
    id: 'pm.pkg.fallback',
    axis: 'packageManagers',
    value: 'npm',
    filePattern: 'package.json',
    weight: 0.3,
  },

  // --- package managers (Python) ---------------------------------------
  {
    id: 'pm.poetry',
    axis: 'packageManagers',
    value: 'poetry',
    filePattern: 'poetry.lock',
    weight: 1.0,
  },
  { id: 'pm.uv', axis: 'packageManagers', value: 'uv', filePattern: 'uv.lock', weight: 1.0 },
  { id: 'pm.pdm', axis: 'packageManagers', value: 'pdm', filePattern: 'pdm.lock', weight: 1.0 },
  {
    id: 'pm.pip',
    axis: 'packageManagers',
    value: 'pip',
    filePattern: 'requirements.txt',
    weight: 0.4,
  },

  // --- test runners -----------------------------------------------------
  {
    id: 'tr.vitest.cfg.js',
    axis: 'testRunners',
    value: 'vitest',
    filePattern: 'vitest.config.js',
    weight: 1.0,
  },
  {
    id: 'tr.vitest.cfg.ts',
    axis: 'testRunners',
    value: 'vitest',
    filePattern: 'vitest.config.ts',
    weight: 1.0,
  },
  {
    id: 'tr.vitest.cfg.mjs',
    axis: 'testRunners',
    value: 'vitest',
    filePattern: 'vitest.config.mjs',
    weight: 1.0,
  },
  {
    id: 'tr.vitest.pkg',
    axis: 'testRunners',
    value: 'vitest',
    filePattern: 'package.json',
    contentProbe: /"vitest"\s*:/,
    weight: 0.8,
  },
  {
    id: 'tr.jest.cfg.js',
    axis: 'testRunners',
    value: 'jest',
    filePattern: 'jest.config.js',
    weight: 1.0,
  },
  {
    id: 'tr.jest.cfg.ts',
    axis: 'testRunners',
    value: 'jest',
    filePattern: 'jest.config.ts',
    weight: 1.0,
  },
  {
    id: 'tr.jest.pkg',
    axis: 'testRunners',
    value: 'jest',
    filePattern: 'package.json',
    contentProbe: /"jest"\s*:/,
    weight: 0.8,
  },
  {
    id: 'tr.pytest.ini',
    axis: 'testRunners',
    value: 'pytest',
    filePattern: 'pytest.ini',
    weight: 1.0,
  },
  {
    id: 'tr.pytest.pyproject',
    axis: 'testRunners',
    value: 'pytest',
    filePattern: 'pyproject.toml',
    contentProbe: /\[tool\.pytest/,
    weight: 0.9,
  },
  {
    id: 'tr.pytest.deps',
    axis: 'testRunners',
    value: 'pytest',
    filePattern: 'pyproject.toml',
    contentProbe: /\bpytest\b/,
    weight: 0.6,
  },

  // --- linters ----------------------------------------------------------
  {
    id: 'ln.eslint.config',
    axis: 'linters',
    value: 'eslint',
    filePattern: 'eslint.config.js',
    weight: 1.0,
  },
  {
    id: 'ln.eslint.config.ts',
    axis: 'linters',
    value: 'eslint',
    filePattern: 'eslint.config.ts',
    weight: 1.0,
  },
  {
    id: 'ln.eslint.rc',
    axis: 'linters',
    value: 'eslint',
    filePattern: '.eslintrc.json',
    weight: 1.0,
  },
  {
    id: 'ln.eslint.rc.js',
    axis: 'linters',
    value: 'eslint',
    filePattern: '.eslintrc.js',
    weight: 1.0,
  },
  {
    id: 'ln.eslint.rc.cjs',
    axis: 'linters',
    value: 'eslint',
    filePattern: '.eslintrc.cjs',
    weight: 1.0,
  },
  {
    id: 'ln.ruff.toml',
    axis: 'linters',
    value: 'ruff',
    filePattern: 'ruff.toml',
    weight: 1.0,
  },
  {
    id: 'ln.ruff.pyproject',
    axis: 'linters',
    value: 'ruff',
    filePattern: 'pyproject.toml',
    contentProbe: /\[tool\.ruff/,
    weight: 0.9,
  },
  {
    id: 'ln.golangci',
    axis: 'linters',
    value: 'golangci-lint',
    filePattern: '.golangci.yml',
    weight: 1.0,
  },
  {
    id: 'ln.golangci.yaml',
    axis: 'linters',
    value: 'golangci-lint',
    filePattern: '.golangci.yaml',
    weight: 1.0,
  },

  // --- CI providers -----------------------------------------------------
  {
    id: 'ci.github',
    axis: 'ciProvider',
    value: 'github-actions',
    filePattern: '.github/workflows/*.yml',
    weight: 1.0,
  },
  {
    id: 'ci.github.yaml',
    axis: 'ciProvider',
    value: 'github-actions',
    filePattern: '.github/workflows/*.yaml',
    weight: 1.0,
  },
  {
    id: 'ci.gitlab',
    axis: 'ciProvider',
    value: 'gitlab-ci',
    filePattern: '.gitlab-ci.yml',
    weight: 1.0,
  },
  {
    id: 'ci.circle',
    axis: 'ciProvider',
    value: 'circleci',
    filePattern: '.circleci/config.yml',
    weight: 1.0,
  },
  {
    id: 'ci.jenkins',
    axis: 'ciProvider',
    value: 'jenkins',
    filePattern: 'Jenkinsfile',
    weight: 1.0,
  },
] as const;
