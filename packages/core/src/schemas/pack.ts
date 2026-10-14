import { z } from 'zod';

/**
 * Rule-pack manifest schema (`pack.yaml`).
 * Source of truth: run.md §7.3 + §11.4 (licensing).
 */

export const Severity = z.enum(['error', 'warning', 'info']);
export type Severity = z.infer<typeof Severity>;

export const CheckEngine = z.enum([
  'dependency-cruiser',
  'eslint',
  'semgrep',
  'import-linter',
  'archunit',
  'custom',
]);
export type CheckEngine = z.infer<typeof CheckEngine>;

const Scope = z
  .object({
    globs: z.array(z.string().min(1)).default([]),
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const GuidanceRule = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/, {
      message: 'Rule id must look like LAYER-01',
    }),
    title: z.string().min(1),
    body: z.string().min(1),
    scope: Scope.default({ globs: [], tags: [] }),
    severity: Severity.default('warning'),
  })
  .strict();
export type GuidanceRule = z.infer<typeof GuidanceRule>;

export const CheckRule = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/),
    gate: z.enum(['secrets', 'lint', 'tests', 'coverage', 'architecture', 'dependencies', 'spec']),
    engine: CheckEngine,
    config: z.string().min(1),
    message: z.string().min(1),
    fix_hint: z.string().min(1),
  })
  .strict();
export type CheckRule = z.infer<typeof CheckRule>;

export const AppliesTo = z
  .object({
    languages: z.array(z.string().min(1)).default([]),
    frameworks: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const PackManifest = z
  .object({
    name: z.string().min(1),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, { message: 'version must be semver' }),
    // run.md §11.4: license is mandatory, no exceptions.
    license: z.string().min(1, {
      message:
        'A rule pack must declare its license (run.md §11.4). Use SPDX, e.g. "MIT" or "Apache-2.0".',
    }),
    source: z.string().min(1, {
      message: 'A rule pack must declare its source (URL or "original") per run.md §11.4.',
    }),
    applies_to: AppliesTo,
    guidance: z.array(GuidanceRule).default([]),
    checks: z.array(CheckRule).default([]),
  })
  .strict();
export type PackManifest = z.infer<typeof PackManifest>;
