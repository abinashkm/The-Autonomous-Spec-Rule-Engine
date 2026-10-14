import { z } from 'zod';

/**
 * Normalized gate result.
 * Source of truth: run.md §7.4.
 *
 * `status` enum: pass | fail | warn | skipped | error
 *  - "error" means the tool failed to run (distinct from a finding).
 */

export const GateStatus = z.enum(['pass', 'fail', 'warn', 'skipped', 'error']);
export type GateStatus = z.infer<typeof GateStatus>;

export const FindingSeverity = z.enum(['error', 'warning', 'info']);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const Finding = z
  .object({
    id: z.string().min(1),
    severity: FindingSeverity,
    file: z.string().min(1),
    line: z.number().int().min(1).nullable(),
    message: z.string().min(1),
    fix_hint: z.string().min(1),
    auto_fixable: z.boolean().default(false),
    rule_ref: z.string().nullable().default(null),
    spec_ref: z.string().nullable().default(null),
  })
  .strict();
export type Finding = z.infer<typeof Finding>;

export const GateTool = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1).nullable().default(null),
  })
  .strict();

export const GateResult = z
  .object({
    gate: z.string().min(1),
    status: GateStatus,
    blocking: z.boolean(),
    duration_ms: z.number().int().min(0),
    findings: z.array(Finding).default([]),
    tool: GateTool,
    skipped_reason: z.string().min(1).optional(),
    error_message: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === 'skipped' && !val.skipped_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status 'skipped' must set skipped_reason (never silently skip, run.md §10.3).",
        path: ['skipped_reason'],
      });
    }
    if (val.status === 'error' && !val.error_message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status 'error' must set error_message.",
        path: ['error_message'],
      });
    }
    if ((val.status === 'pass' || val.status === 'skipped') && val.findings.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `status '${val.status}' must have an empty findings array.`,
        path: ['findings'],
      });
    }
  });
export type GateResult = z.infer<typeof GateResult>;
