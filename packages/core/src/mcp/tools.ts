import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseRequirements, parseTasks } from '../spec/parse.js';
import {
  findSpecDir,
  listSpecs,
  REQUIREMENTS_FILE,
  TASKS_FILE,
  SPECS_RELDIR,
  type SpecSummary,
} from '../spec/workflow.js';
import type { ParsedRequirements } from '../schemas/spec.js';
import type { PackManifest } from '../schemas/pack.js';
import { PackManifest as PackManifestSchema } from '../schemas/pack.js';
import { runCheck } from '../check/run.js';
import { buildCorrectionPrompt, type CorrectionPayload } from '../fixloop/builder.js';
import type { GateResult } from '../schemas/gate-result.js';
import type { Config } from '../schemas/config.js';
import { resolveConfig } from '../config/load.js';
import yaml from 'js-yaml';

/**
 * Business logic for the 7 MCP tools in run.md §9.2.
 * The MCP adapter (packages/mcp) is a thin wrapper — all logic lives here per
 * §22.3 so each tool is unit-testable without a running MCP server.
 */

/* --------------------------- get_active_spec --------------------------- */

export interface ActiveSpec {
  readonly summary: SpecSummary;
  readonly parsed: ParsedRequirements;
}

/**
 * The "active" spec is the newest approved (or implemented) spec. Falls back
 * to the newest draft so the tool is still useful during interview workflow.
 */
export function getActiveSpec(cwd: string): ActiveSpec | null {
  const summaries = listSpecs(cwd);
  if (summaries.length === 0) return null;
  const approved = summaries.filter((s) => s.status === 'approved' || s.status === 'implemented');
  const picked = (approved.length > 0 ? approved : summaries).slice(-1)[0]!;
  const reqPath = join(picked.dir, REQUIREMENTS_FILE);
  if (!existsSync(reqPath)) return null;
  try {
    const parsed = parseRequirements(readFileSync(reqPath, 'utf8'));
    return { summary: picked, parsed };
  } catch {
    return null;
  }
}

/* ------------------------------- list_tasks ---------------------------- */

export interface TaskSummary {
  readonly specId: string;
  readonly specDir: string;
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly implements: readonly string[];
  readonly tags: readonly string[];
}

export function listAllTasks(cwd: string, filter?: { readonly done?: boolean }): TaskSummary[] {
  const out: TaskSummary[] = [];
  for (const spec of listSpecs(cwd)) {
    const tasksPath = join(spec.dir, TASKS_FILE);
    if (!existsSync(tasksPath)) continue;
    try {
      const parsed = parseTasks(readFileSync(tasksPath, 'utf8'));
      for (const t of parsed.tasks) {
        if (filter?.done !== undefined && t.done !== filter.done) continue;
        out.push({
          specId: spec.specId,
          specDir: spec.dir,
          id: t.id,
          title: t.title,
          done: t.done,
          implements: t.implements,
          tags: t.tags,
        });
      }
    } catch {
      // ignore unparseable tasks.md
    }
  }
  return out;
}

/* ---------------------------- get_task_context ------------------------- */

export interface TaskContext {
  readonly specId: string;
  readonly task: TaskSummary;
  readonly acceptanceCriteria: readonly { id: string; text: string }[];
  readonly relevantFiles: readonly string[];
  readonly rules: readonly {
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly severity: 'error' | 'warning' | 'info';
    readonly fromPack: string;
  }[];
  readonly budget: {
    readonly maxTokens: number;
    readonly usedTokens: number;
    readonly omittedRules: readonly { id: string; reason: string }[];
  };
}

/** Rough token estimator (4 chars/token). Keep this in sync with agents-md/render. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Walk every installed-pack manifest under .specgate/rules and return the
 * ones whose applies_to.languages intersect the task's tags OR whose
 * guidance scope.globs match a tagged file path.
 *
 * In M6 we return an empty array when no packs are installed — the architecture
 * gate + first-party packs land in P1 post-MVP. The function is wired so
 * once packs ship, the MCP tool automatically exposes them.
 */
function loadInstalledPacks(cwd: string): PackManifest[] {
  const dir = resolve(cwd, '.specgate', 'rules');
  if (!existsSync(dir)) return [];
  const packs: PackManifest[] = [];
  for (const name of readdirSync(dir)) {
    const manifest = resolve(dir, name, 'pack.yaml');
    if (!existsSync(manifest)) continue;
    try {
      const raw = yaml.load(readFileSync(manifest, 'utf8')) as unknown;
      packs.push(PackManifestSchema.parse(raw));
    } catch {
      /* malformed packs are silently ignored — a user-facing lint of packs lands post-MVP */
    }
  }
  return packs;
}

function minimatch(pattern: string, path: string): boolean {
  // Reuse the stack-detector glob matcher by splitting into segments.
  // Supports * within segments and ** for arbitrary depth.
  const pSegs = pattern.split('/').filter(Boolean);
  const tSegs = path.split('/').filter(Boolean);
  const walk = (pi: number, ti: number): boolean => {
    if (pi === pSegs.length) return ti === tSegs.length;
    const seg = pSegs[pi]!;
    if (seg === '**') {
      for (let k = ti; k <= tSegs.length; k++) if (walk(pi + 1, k)) return true;
      return false;
    }
    if (ti === tSegs.length) return false;
    const re = new RegExp(
      '^' + seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    if (!re.test(tSegs[ti]!)) return false;
    return walk(pi + 1, ti + 1);
  };
  return walk(0, 0);
}

function findFilesByGlobs(cwd: string, globs: readonly string[]): string[] {
  if (globs.length === 0) return [];
  const matches = new Set<string>();
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })) {
      if (['node_modules', '.git', 'dist', '.specgate'].includes(ent.name)) continue;
      const sub = join(dir, ent.name);
      if (ent.isDirectory()) walk(sub);
      else if (ent.isFile()) {
        const rel = relative(cwd, sub).split('\\').join('/');
        for (const g of globs) {
          if (minimatch(g, rel)) {
            matches.add(rel);
            break;
          }
        }
      }
    }
  };
  try {
    walk(resolve(cwd));
  } catch {
    /* ignore */
  }
  return [...matches].sort();
}

export function getTaskContext(options: {
  readonly cwd: string;
  readonly taskId: string;
  readonly maxTokens?: number;
}): TaskContext | null {
  const tasks = listAllTasks(options.cwd);
  const task = tasks.find((t) => t.id === options.taskId);
  if (!task) return null;

  const reqPath = join(task.specDir, REQUIREMENTS_FILE);
  const parsed = parseRequirements(readFileSync(reqPath, 'utf8'));
  const acMap = new Map<string, string>();
  for (const r of parsed.requirements) {
    for (const ac of r.acceptanceCriteria) acMap.set(ac.id, ac.text);
  }
  const acceptanceCriteria = task.implements
    .filter((id) => acMap.has(id))
    .map((id) => ({ id, text: acMap.get(id)! }));

  const packs = loadInstalledPacks(options.cwd);
  const taggedTag = new Set(task.tags.map((t) => t.toLowerCase()));

  // Collect rules whose scope tags/globs match this task.
  const relevantFiles = new Set<string>();
  type ScoredRule = {
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly severity: 'error' | 'warning' | 'info';
    readonly fromPack: string;
    readonly score: number;
  };
  const scored: ScoredRule[] = [];
  for (const pack of packs) {
    for (const rule of pack.guidance) {
      const tagMatch = rule.scope.tags.some((t) => taggedTag.has(t.toLowerCase()));
      const globMatches = findFilesByGlobs(options.cwd, rule.scope.globs);
      for (const f of globMatches) relevantFiles.add(f);
      const score = (tagMatch ? 2 : 0) + (globMatches.length > 0 ? 1 : 0);
      if (score > 0) {
        scored.push({
          id: rule.id,
          title: rule.title,
          body: rule.body,
          severity: rule.severity,
          fromPack: pack.name,
          score,
        });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  // Enforce the budget.
  const maxTokens = options.maxTokens ?? 4000;
  let used = 0;
  const kept: ScoredRule[] = [];
  const omitted: Array<{ id: string; reason: string }> = [];
  for (const r of scored) {
    const t = estimateTokens(r.body) + estimateTokens(r.title);
    if (used + t > maxTokens) {
      omitted.push({ id: r.id, reason: 'token-budget' });
      continue;
    }
    used += t;
    kept.push(r);
  }

  return {
    specId: parsed.frontmatter.id,
    task,
    acceptanceCriteria,
    relevantFiles: [...relevantFiles].sort(),
    rules: kept.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      severity: r.severity,
      fromPack: r.fromPack,
    })),
    budget: { maxTokens, usedTokens: used, omittedRules: omitted },
  };
}

/* ----------------------------- update_task ----------------------------- */

export class UpdateTaskError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'UpdateTaskError';
    this.code = code;
  }
}

/**
 * Flip a task's checkbox in `tasks.md`.
 *
 * Guard: when `done=true`, we require that at least one AC the task implements
 * is referenced somewhere in the repo's test files. This is a simpler form of
 * the full traceability check from M7 — stricter than nothing, lighter than
 * running the whole gate suite. Full enforcement lands with M7's annotation
 * parser.
 */
export function updateTaskStatus(options: {
  readonly cwd: string;
  readonly taskId: string;
  readonly done: boolean;
}): { readonly task: TaskSummary; readonly path: string } {
  const tasks = listAllTasks(options.cwd);
  const task = tasks.find((t) => t.id === options.taskId);
  if (!task) throw new UpdateTaskError('E_TASK_NOT_FOUND', `No task matches: ${options.taskId}`);
  const tasksPath = join(task.specDir, TASKS_FILE);
  const raw = readFileSync(tasksPath, 'utf8');

  if (options.done) {
    // Light traceability check: look for `AC-xxx.y` strings in test files.
    const hasRef = acReferencedInTests(options.cwd, task.implements);
    if (!hasRef) {
      throw new UpdateTaskError(
        'E_UNTESTED_AC',
        `Refusing to mark ${task.id} done — no test file references any of ${task.implements.join(', ')}. ` +
          'Add a test that cites the AC id (e.g. `it("AC-001.1: ...")`).',
      );
    }
  }

  const boxRe = new RegExp(`(^\\s*-\\s*)\\[[ xX]\\](\\s+\\*{0,2}${task.id}\\*{0,2}\\b)`, 'm');
  if (!boxRe.test(raw))
    throw new UpdateTaskError(
      'E_TASK_LINE_NOT_FOUND',
      `Could not locate task line for ${task.id}.`,
    );
  const replaced = raw.replace(boxRe, (_m, lead: string, suffix: string) => {
    return `${lead}[${options.done ? 'x' : ' '}]${suffix}`;
  });
  writeFileSync(tasksPath, replaced, 'utf8');
  return {
    task: { ...task, done: options.done },
    path: tasksPath,
  };
}

const AC_IN_TESTS = /\bAC-\d{3}\.\d+\b/g;

function acReferencedInTests(cwd: string, acIds: readonly string[]): boolean {
  if (acIds.length === 0) return true;
  const want = new Set(acIds);
  const roots = [resolve(cwd, 'test'), resolve(cwd, 'tests'), resolve(cwd, 'src')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const walk = (dir: string): boolean => {
      try {
        for (const ent of readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })) {
          if (['node_modules', '.git', 'dist'].includes(ent.name)) continue;
          const sub = join(dir, ent.name);
          if (ent.isDirectory()) {
            if (walk(sub)) return true;
          } else if (
            ent.isFile() &&
            /\.(test|spec)\.(t|j)sx?$|_test\.py$|test_[^/]+\.py$/.test(ent.name)
          ) {
            const content = readFileSync(sub, 'utf8');
            for (const m of content.matchAll(AC_IN_TESTS)) {
              if (want.has(m[0])) return true;
            }
          }
        }
      } catch {
        /* ignore */
      }
      return false;
    };
    if (walk(root)) return true;
  }
  return false;
}

/* ------------------------------- check --------------------------------- */

export interface McpCheckResult {
  readonly results: readonly GateResult[];
  readonly fixPrompt: { readonly text: string; readonly payload: CorrectionPayload } | null;
  readonly summary: {
    readonly pass: number;
    readonly fail: number;
    readonly warn: number;
    readonly skipped: number;
    readonly error: number;
    readonly blockingFailures: number;
  };
}

export async function runMcpCheck(options: {
  readonly cwd: string;
  readonly scope?: 'staged' | 'changed' | 'full';
  readonly gates?: readonly string[];
}): Promise<McpCheckResult> {
  const run = await runCheck({
    cwd: options.cwd,
    scope: options.scope ?? 'full',
    ...(options.gates && options.gates.length > 0 ? { gates: options.gates } : {}),
  });
  const config = run.config;
  const hasBlocking = run.summary.blockingFailures > 0;
  const fixPrompt = hasBlocking
    ? buildCorrectionPrompt(run.results, {
        attempt: 1,
        maxAttempts: config.fix_loop.max_attempts,
      })
    : null;
  return {
    results: run.results,
    fixPrompt,
    summary: run.summary,
  };
}

/* ------------------------------ get_rule ------------------------------- */

export interface RuleLookup {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly fromPack: string;
}

export function getRule(cwd: string, ruleId: string): RuleLookup | null {
  for (const pack of loadInstalledPacks(cwd)) {
    for (const g of pack.guidance) {
      if (g.id === ruleId) {
        return {
          id: g.id,
          title: g.title,
          body: g.body,
          severity: g.severity,
          fromPack: pack.name,
        };
      }
    }
  }
  return null;
}

/* --------------------------- propose_spec_change ----------------------- */

export interface Proposal {
  readonly specId: string;
  readonly title: string;
  readonly body: string;
  readonly submittedBy?: string;
  readonly submittedAt?: string;
}

/**
 * Write a proposal under `.specgate/specs/<id>/proposals/NNN.md`. Never edits
 * the live spec. A human runs `specgate spec accept-proposal` to merge.
 */
export function proposeSpecChange(options: {
  readonly cwd: string;
  readonly specIdOrName: string;
  readonly proposal: Proposal;
  readonly now?: () => Date;
}): { readonly path: string } {
  const specDir = findSpecDir(options.cwd, options.specIdOrName);
  if (!specDir) throw new Error(`No spec matches: ${options.specIdOrName}`);
  const proposalsDir = join(specDir, 'proposals');
  mkdirSync(proposalsDir, { recursive: true });
  const existing = existsSync(proposalsDir) ? readdirSync(proposalsDir) : [];
  const nextN = String(existing.length + 1).padStart(3, '0');
  const now = (options.now ?? (() => new Date()))();
  const path = join(proposalsDir, `${nextN}.md`);
  const body = [
    '---',
    `specId: ${options.proposal.specId}`,
    `submittedAt: ${now.toISOString()}`,
    `status: pending`,
    options.proposal.submittedBy ? `submittedBy: ${options.proposal.submittedBy}` : null,
    '---',
    '',
    `# ${options.proposal.title}`,
    '',
    options.proposal.body,
    '',
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
  writeFileSync(path, body, 'utf8');
  return { path };
}

/* --------------------------- resources: status ------------------------- */

export interface StatusResource {
  readonly cwd: string;
  readonly config: Config;
  readonly specs: readonly SpecSummary[];
  readonly tasks: { readonly total: number; readonly done: number };
}

export function getStatusResource(cwd: string): StatusResource {
  const config = resolveConfig({ cwd });
  const specs = listSpecs(cwd);
  const tasks = listAllTasks(cwd);
  return {
    cwd,
    config,
    specs,
    tasks: { total: tasks.length, done: tasks.filter((t) => t.done).length },
  };
}

/** Fetch the raw markdown for an existing spec (used by the spec:// resource). */
export function getSpecMarkdown(cwd: string, specId: string): string | null {
  const dir = findSpecDir(cwd, specId);
  if (!dir) return null;
  const path = join(dir, REQUIREMENTS_FILE);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/** Path helpers for tests. Namespaced to avoid barrel-export collisions. */
export const _MCP_INTERNAL = {
  SPECS_RELDIR,
  loadInstalledPacks,
};
