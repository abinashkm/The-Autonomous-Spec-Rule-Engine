import { z } from 'zod';

/**
 * Config schema for `.specgate/config.yaml`.
 * Source of truth: run.md §7.2.
 */

export const Strictness = z.enum(['advisory', 'standard', 'strict']);
export type Strictness = z.infer<typeof Strictness>;

const SecretsGate = z
  .object({
    enabled: z.boolean().default(true),
    tool: z.string().default('gitleaks'),
    blocking_at: Strictness.default('standard'),
    reason: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.enabled === false && !val.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A disabled gate must declare a reason (run.md §13.3).',
        path: ['reason'],
      });
    }
  });

const LintGate = z
  .object({
    enabled: z.boolean().default(true),
    command: z.union([z.literal('auto'), z.string()]).default('auto'),
    blocking_at: Strictness.default('standard'),
    reason: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.enabled === false && !val.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A disabled gate must declare a reason (run.md §13.3).',
        path: ['reason'],
      });
    }
  });

const TestsGate = LintGate;

const CoverageGate = z
  .object({
    enabled: z.boolean().default(true),
    changed_files_min: z.number().int().min(0).max(100).default(70),
    blocking_at: Strictness.default('strict'),
    reason: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.enabled === false && !val.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A disabled gate must declare a reason (run.md §13.3).',
        path: ['reason'],
      });
    }
  });

const ArchitectureGate = z
  .object({
    enabled: z.boolean().default(true),
    blocking_at: Strictness.default('strict'),
    reason: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.enabled === false && !val.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A disabled gate must declare a reason (run.md §13.3).',
        path: ['reason'],
      });
    }
  });

const DependenciesGate = z
  .object({
    enabled: z.boolean().default(true),
    tool: z.string().default('osv-scanner'),
    blocking_at: Strictness.default('strict'),
    reason: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.enabled === false && !val.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A disabled gate must declare a reason (run.md §13.3).',
        path: ['reason'],
      });
    }
  });

const SpecGate = z
  .object({
    enabled: z.boolean().default(true),
    require_spec_for_changes: z.boolean().default(true),
    blocking_at: Strictness.default('strict'),
    reason: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.enabled === false && !val.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A disabled gate must declare a reason (run.md §13.3).',
        path: ['reason'],
      });
    }
  });

const Gates = z
  .object({
    secrets: SecretsGate,
    lint: LintGate,
    tests: TestsGate,
    coverage: CoverageGate,
    architecture: ArchitectureGate,
    dependencies: DependenciesGate,
    spec: SpecGate,
  })
  .strict();

const PackRef = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

const StackOverride = z
  .object({
    languages: z.array(z.string()).optional(),
    frameworks: z.array(z.string()).optional(),
    packageManagers: z.array(z.string()).optional(),
    testRunners: z.array(z.string()).optional(),
    linters: z.array(z.string()).optional(),
    ciProvider: z.string().optional(),
  })
  .strict();

export const ConfigSchema = z
  .object({
    version: z.literal(1),
    strictness: Strictness,
    stack: z.object({ override: StackOverride.default({}) }).default({ override: {} }),
    packs: z.array(PackRef).default([]),
    gates: Gates,
    fix_loop: z
      .object({ max_attempts: z.number().int().min(1).max(10) })
      .default({ max_attempts: 3 }),
    context: z
      .object({ max_rule_tokens: z.number().int().min(500).max(100000) })
      .default({ max_rule_tokens: 4000 }),
    telemetry: z
      .enum(['off', 'on'])
      .default('off'),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export const GateIds = [
  'secrets',
  'lint',
  'tests',
  'coverage',
  'architecture',
  'dependencies',
  'spec',
] as const;
export type GateId = (typeof GateIds)[number];
