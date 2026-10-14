import { z } from 'zod';

/**
 * Spec schemas for `requirements.md` frontmatter + `tasks.md` task rows.
 * Source of truth: run.md §7.1.
 */

export const ReqId = z.string().regex(/^REQ-\d{3}$/, { message: 'ID must match REQ-\\d{3}' });
export const AcId = z
  .string()
  .regex(/^AC-\d{3}\.\d+$/, { message: 'ID must match AC-\\d{3}\\.\\d+' });
export const TaskId = z.string().regex(/^T-\d{3}$/, { message: 'ID must match T-\\d{3}' });
export const NfrId = z.string().regex(/^NFR-\d{3}$/, { message: 'ID must match NFR-\\d{3}' });
export const SpecId = z.string().regex(/^SPEC-\d{3}$/, { message: 'ID must match SPEC-\\d{3}' });

export const SpecStatus = z.enum(['draft', 'approved', 'implemented']);
export type SpecStatus = z.infer<typeof SpecStatus>;

export const SpecFrontmatter = z
  .object({
    id: SpecId,
    title: z.string().min(1, { message: 'title must not be empty' }),
    status: SpecStatus,
    created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'created must be YYYY-MM-DD' }),
  })
  .strict();

export type SpecFrontmatter = z.infer<typeof SpecFrontmatter>;

export const AcceptanceCriterion = z
  .object({
    id: AcId,
    text: z.string().min(1, { message: 'AC body must not be empty' }),
    deprecated: z.boolean().default(false),
  })
  .strict();
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const Requirement = z
  .object({
    id: ReqId,
    title: z.string().min(1),
    acceptanceCriteria: z.array(AcceptanceCriterion).min(1, {
      message: 'A requirement must have at least one acceptance criterion',
    }),
    deprecated: z.boolean().default(false),
  })
  .strict();
export type Requirement = z.infer<typeof Requirement>;

export const Nfr = z.object({ id: NfrId, text: z.string().min(1) }).strict();

export const ParsedRequirements = z
  .object({
    frontmatter: SpecFrontmatter,
    context: z.string().default(''),
    requirements: z.array(Requirement),
    nonFunctional: z.array(Nfr).default([]),
    outOfScope: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Reject duplicate IDs across REQ + AC + NFR.
    const seen = new Set<string>();
    for (const r of val.requirements) {
      if (seen.has(r.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate requirement id: ${r.id}`,
          path: ['requirements'],
        });
      }
      seen.add(r.id);
      for (const ac of r.acceptanceCriteria) {
        if (seen.has(ac.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate id: ${ac.id}`,
            path: ['requirements'],
          });
        }
        seen.add(ac.id);
      }
    }
    for (const n of val.nonFunctional) {
      if (seen.has(n.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate id: ${n.id}`,
          path: ['nonFunctional'],
        });
      }
      seen.add(n.id);
    }
  });
export type ParsedRequirements = z.infer<typeof ParsedRequirements>;

export const TaskRow = z
  .object({
    id: TaskId,
    title: z.string().min(1),
    done: z.boolean().default(false),
    implements: z.array(AcId).min(1, {
      message: 'A task must implement at least one acceptance criterion',
    }),
    tags: z.array(z.string()).default([]),
  })
  .strict();
export type TaskRow = z.infer<typeof TaskRow>;

export const ParsedTasks = z
  .object({
    tasks: z.array(TaskRow),
  })
  .strict()
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    for (const t of val.tasks) {
      if (seen.has(t.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate task id: ${t.id}`,
          path: ['tasks'],
        });
      }
      seen.add(t.id);
    }
  });
export type ParsedTasks = z.infer<typeof ParsedTasks>;
