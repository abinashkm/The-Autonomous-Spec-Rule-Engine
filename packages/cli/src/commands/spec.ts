import { intro, outro, log, isCancel, cancel, text, confirm } from '@clack/prompts';
import {
  INTERVIEW_QUESTIONS,
  type InterviewAnswers,
  listSpecs,
  specApprove,
  specNew,
  specPlan,
  specTasks,
  specValidate,
  SpecWorkflowError,
} from '@specgate/core';

/**
 * `specgate spec <subcommand>` adapter.
 * All business logic lives in core (run.md §22.3).
 */

export interface SpecCommandOptions {
  readonly cwd: string;
  readonly json?: boolean;
}

/* ------------------------------- spec new ------------------------------ */

async function promptAnswers(initialName?: string): Promise<InterviewAnswers | null> {
  const answers: Record<string, unknown> = {};
  for (const q of INTERVIEW_QUESTIONS) {
    const initial = q.id === 'name' ? initialName : undefined;
    const value = await text({
      message: q.prompt,
      ...(q.placeholder ? { placeholder: q.placeholder } : {}),
      ...(initial ? { initialValue: initial } : {}),
    });
    if (isCancel(value)) {
      cancel('Aborted.');
      return null;
    }
    if (q.kind === 'list') {
      const parts = (value as string)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      answers[q.id] = parts;
    } else {
      answers[q.id] = value;
    }
  }
  return answers as unknown as InterviewAnswers;
}

export async function specNewCommand(
  options: SpecCommandOptions & { readonly name?: string; readonly yes?: boolean },
): Promise<number> {
  if (options.json) {
    // Non-interactive path for JSON callers (e.g. agents + CI). Requires a
    // minimal set of answers from stdin — out of scope for M2; the MCP tool
    // in M6 is the proper agent interface. For now, print guidance.
    process.stderr.write(
      'specgate spec new --json is reserved for the MCP server (M6). Use the interactive form or call runInit from core directly.\n',
    );
    return 2;
  }

  intro('SpecGate: new spec');
  const answers = await promptAnswers(options.name);
  if (!answers) return 1;

  const ok = await confirm({
    message: `Create a draft spec for "${answers.name}"?`,
    initialValue: true,
  });
  if (isCancel(ok) || !ok) {
    cancel('Aborted.');
    return 1;
  }

  try {
    const r = specNew({ cwd: options.cwd, answers });
    log.step(`Created ${r.specId}`);
    log.step(r.requirementsPath);
    outro('Edit the AC placeholders, then run `specgate spec validate ' + r.specId + '`.');
    return 0;
  } catch (err) {
    log.error((err as Error).message);
    return 2;
  }
}

/* ----------------------------- spec validate --------------------------- */

export async function specValidateCommand(
  options: SpecCommandOptions & { readonly specId: string },
): Promise<number> {
  try {
    const r = specValidate(options.cwd, options.specId);
    if (options.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return r.valid ? 0 : 1;
    }
    if (r.valid) {
      log.success(`Spec at ${r.specDir} is valid.`);
      return 0;
    }
    log.warn(`Spec has ${r.issues.length} issue(s):`);
    for (const i of r.issues) {
      log.error(`  [${i.code}] ${i.id ?? ''} ${i.message}`);
    }
    return 1;
  } catch (err) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ error: (err as Error).message }) + '\n');
    } else {
      log.error((err as Error).message);
    }
    return 2;
  }
}

/* ----------------------------- spec approve ---------------------------- */

export async function specApproveCommand(
  options: SpecCommandOptions & { readonly specId: string },
): Promise<number> {
  try {
    const r = specApprove({ cwd: options.cwd, specIdOrName: options.specId });
    if (options.json) {
      process.stdout.write(
        JSON.stringify({ specId: r.specId, specDir: r.specDir, lock: r.lock }, null, 2) + '\n',
      );
      return 0;
    }
    log.success(`Approved ${r.specId}. ids.lock.json written with ${r.lock.ids.length} ids.`);
    return 0;
  } catch (err) {
    if (err instanceof SpecWorkflowError && err.code === 'E_SPEC_INVALID') {
      if (options.json) process.stdout.write(JSON.stringify({ error: err.message }) + '\n');
      else log.error(err.message);
      return 1;
    }
    if (options.json)
      process.stdout.write(JSON.stringify({ error: (err as Error).message }) + '\n');
    else log.error((err as Error).message);
    return 2;
  }
}

/* ------------------------------- spec plan ----------------------------- */

export async function specPlanCommand(
  options: SpecCommandOptions & { readonly specId: string },
): Promise<number> {
  try {
    const r = specPlan(options.cwd, options.specId);
    if (options.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return 0;
    }
    if (r.action === 'created') log.success(`Created ${r.designPath}`);
    else log.step(`design.md already present at ${r.designPath}`);
    return 0;
  } catch (err) {
    if (options.json)
      process.stdout.write(JSON.stringify({ error: (err as Error).message }) + '\n');
    else log.error((err as Error).message);
    return 1;
  }
}

/* ------------------------------- spec tasks ---------------------------- */

export async function specTasksCommand(
  options: SpecCommandOptions & { readonly specId: string },
): Promise<number> {
  try {
    const r = specTasks({ cwd: options.cwd, specIdOrName: options.specId });
    if (options.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return 0;
    }
    if (r.action === 'created') {
      log.success(`Created ${r.tasksPath}`);
      log.step(`spec hash: ${r.specSha256.slice(0, 12)}…`);
    } else {
      log.step(`tasks.md already present at ${r.tasksPath} — orphan-link check passed`);
    }
    return 0;
  } catch (err) {
    if (err instanceof SpecWorkflowError && err.code === 'E_ORPHAN_TASK_LINK') {
      if (options.json) process.stdout.write(JSON.stringify({ error: err.message }) + '\n');
      else log.error(err.message);
      return 1;
    }
    if (options.json)
      process.stdout.write(JSON.stringify({ error: (err as Error).message }) + '\n');
    else log.error((err as Error).message);
    return 2;
  }
}

/* -------------------------------- helpers ------------------------------ */

export function specListCommand(options: SpecCommandOptions): number {
  const summaries = listSpecs(options.cwd);
  if (options.json) {
    process.stdout.write(JSON.stringify(summaries, null, 2) + '\n');
    return 0;
  }
  if (summaries.length === 0) {
    log.step('No specs yet. Run `specgate spec new` to create one.');
    return 0;
  }
  for (const s of summaries) {
    log.step(`${s.specId}  [${s.status}]  ${s.title}`);
  }
  return 0;
}
