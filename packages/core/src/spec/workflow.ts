import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import matter from 'gray-matter';
import type { InterviewAnswers } from './interview/questions.js';
import { renderDraftRequirements } from './interview/render.js';
import { parseRequirements, parseTasks } from './parse.js';
import {
  collectIds,
  readIdsLock,
  validateImmutability,
  validateSpec,
  writeIdsLock,
  type IdsLock,
  type ValidationIssue,
  type ValidationResult,
} from './validate.js';
import { nextId } from './ids.js';
import type { ParsedRequirements as ParsedRequirementsT } from '../schemas/spec.js';

/**
 * File-system layer for the spec workflow (M2.C–D).
 * Source of truth: run.md §6 (on-disk layout) + §8 (CLI).
 *
 * Layout under the repo:
 *   .specgate/specs/
 *     001-feature-slug/
 *       requirements.md   (always)
 *       ids.lock.json     (after `approve`)
 *       design.md         (after `plan`)
 *       tasks.md          (after `tasks`)
 *       tasks.meta.json   (after `tasks` — spec hash for drift)
 */

export const SPECS_RELDIR = '.specgate/specs';
export const REQUIREMENTS_FILE = 'requirements.md';
export const DESIGN_FILE = 'design.md';
export const TASKS_FILE = 'tasks.md';
export const TASKS_META_FILE = 'tasks.meta.json';

export class SpecWorkflowError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SpecWorkflowError';
  }
}

/* --------------- slugs, numbering, directory discovery ----------------- */

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** All spec directory names in order (e.g. `['001-foo', '002-bar']`). */
export function listSpecDirs(cwd: string): string[] {
  const dir = resolve(cwd, SPECS_RELDIR);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (/^\d{3}-/.test(name) && statSync(join(dir, name)).isDirectory()) {
      out.push(name);
    }
  }
  out.sort();
  return out;
}

/** Pick the next NNN prefix for a new spec. Never fills gaps (run.md §7.1). */
function nextSpecDirPrefix(cwd: string): string {
  const dirs = listSpecDirs(cwd);
  let max = 0;
  for (const d of dirs) {
    const n = Number(d.slice(0, 3));
    if (n > max) max = n;
  }
  return String(max + 1).padStart(3, '0');
}

/** Match a spec id (`SPEC-xxx`) to its on-disk directory. */
export function findSpecDir(cwd: string, specIdOrName: string): string | null {
  const specsRoot = resolve(cwd, SPECS_RELDIR);
  if (!existsSync(specsRoot)) return null;
  const trim = specIdOrName.trim();
  for (const name of listSpecDirs(cwd)) {
    const reqPath = join(specsRoot, name, REQUIREMENTS_FILE);
    if (!existsSync(reqPath)) continue;
    // Match either on numeric prefix (`001` → `001-...`) or by SPEC-id in frontmatter.
    if (name.startsWith(`${trim}-`) || name === trim) return join(specsRoot, name);
    try {
      const fm = matter(readFileSync(reqPath, 'utf8'));
      if ((fm.data as { id?: string }).id === trim) return join(specsRoot, name);
    } catch {
      // ignore unreadable spec dirs
    }
  }
  return null;
}

/* ---------------------------- spec new --------------------------------- */

export interface SpecNewOptions {
  readonly cwd: string;
  readonly answers: InterviewAnswers;
  readonly now?: () => Date;
}

export interface SpecNewResult {
  readonly specId: string;
  readonly specDir: string;
  readonly requirementsPath: string;
}

export function specNew(options: SpecNewOptions): SpecNewResult {
  const cwd = resolve(options.cwd);
  const prefix = nextSpecDirPrefix(cwd); // 001, 002, ...
  const slug = slugify(options.answers.name) || 'feature';
  const dirname = `${prefix}-${slug}`;
  const specDir = join(cwd, SPECS_RELDIR, dirname);
  if (existsSync(specDir)) {
    throw new SpecWorkflowError(
      'E_SPEC_DIR_EXISTS',
      `Refusing to overwrite existing spec directory: ${specDir}`,
    );
  }
  mkdirSync(specDir, { recursive: true });

  const specId = `SPEC-${prefix}`;
  const now = (options.now ?? (() => new Date()))();
  const createdDate = now.toISOString().slice(0, 10);
  const body = renderDraftRequirements(options.answers, { specId, createdDate });
  const requirementsPath = join(specDir, REQUIREMENTS_FILE);
  writeFileSync(requirementsPath, body + '\n', 'utf8');
  return { specId, specDir, requirementsPath };
}

/* -------------------------- spec validate ------------------------------ */

export interface SpecValidateResult extends ValidationResult {
  readonly specDir: string;
  readonly requirementsPath: string;
  readonly immutabilityIssues: readonly ValidationIssue[];
}

export function specValidate(cwd: string, specIdOrName: string): SpecValidateResult {
  const specDir = findSpecDir(cwd, specIdOrName);
  if (!specDir) throw new SpecWorkflowError('E_SPEC_NOT_FOUND', `No spec matches: ${specIdOrName}`);
  const requirementsPath = join(specDir, REQUIREMENTS_FILE);
  if (!existsSync(requirementsPath))
    throw new SpecWorkflowError(
      'E_SPEC_MISSING_FILE',
      `Missing ${REQUIREMENTS_FILE} in ${specDir}`,
    );

  const raw = readFileSync(requirementsPath, 'utf8');
  const parsed = parseRequirements(raw);
  const base = validateSpec(parsed);

  let immut: ValidationIssue[] = [];
  if (parsed.frontmatter.status !== 'draft') {
    const lock = readIdsLock(specDir);
    if (lock) immut = validateImmutability(parsed, lock);
  }
  const issues = [...base.issues, ...immut];
  return {
    valid: issues.length === 0,
    issues,
    immutabilityIssues: immut,
    specDir,
    requirementsPath,
  };
}

/* --------------------------- spec approve ------------------------------ */

export interface SpecApproveResult {
  readonly specDir: string;
  readonly specId: string;
  readonly lock: IdsLock;
}

export function specApprove(options: {
  readonly cwd: string;
  readonly specIdOrName: string;
  readonly now?: () => Date;
}): SpecApproveResult {
  const { specDir, requirementsPath, valid, issues } = specValidate(
    options.cwd,
    options.specIdOrName,
  );
  if (!valid) {
    throw new SpecWorkflowError(
      'E_SPEC_INVALID',
      `Spec is not valid; refusing to approve.\n` +
        issues.map((i) => `  [${i.code}] ${i.message}`).join('\n'),
    );
  }
  const raw = readFileSync(requirementsPath, 'utf8');
  const fm = matter(raw);
  const parsed = parseRequirements(raw);
  // Flip status → approved. Preserve all other frontmatter + body.
  const nextFm = { ...fm.data, status: 'approved' };
  const stringifiedBody = fm.content.startsWith('\n') ? fm.content : '\n' + fm.content;
  // Rebuild file manually to avoid gray-matter's YAML serializer quirks
  // (date re-serialization) — keep the raw body, swap `status:` only.
  const written = rebuildWithStatus(raw, 'approved');
  writeFileSync(requirementsPath, written, 'utf8');

  // Keep eslint happy without side-effect-less dead vars.
  void nextFm;
  void stringifiedBody;

  const now = (options.now ?? (() => new Date()))();
  const lock: IdsLock = {
    specId: parsed.frontmatter.id,
    approvedAt: now.toISOString(),
    ids: collectIds(parsed),
  };
  writeIdsLock(specDir, lock);
  return { specDir, specId: parsed.frontmatter.id, lock };
}

/** Replace `status: <...>` in the frontmatter of `raw` with the given value.
 *  Leaves the body untouched byte-for-byte to avoid gray-matter's date-reserialization. */
function rebuildWithStatus(raw: string, status: 'draft' | 'approved' | 'implemented'): string {
  const fmMatch = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)/.exec(raw);
  if (!fmMatch) throw new SpecWorkflowError('E_SPEC_FRONTMATTER_MISSING', 'Frontmatter not found.');
  const fmBlock = fmMatch[1]!;
  const body = raw.slice(fmBlock.length);
  const nextFmBlock = fmBlock.replace(/^status:\s*[^\r\n]+/m, `status: ${status}`);
  if (nextFmBlock === fmBlock) {
    // No status line present at all; insert before closing `---`.
    const inserted = fmBlock.replace(
      /^---(\r?\n)([\s\S]*?)(\r?\n---\r?\n)$/,
      (_m, nl1: string, inner: string, nl2: string) =>
        `---${nl1}${inner}${nl1}status: ${status}${nl2}`,
    );
    return inserted + body;
  }
  return nextFmBlock + body;
}

/* ------------------------------ spec plan ------------------------------ */

export interface SpecPlanResult {
  readonly specDir: string;
  readonly designPath: string;
  readonly action: 'created' | 'validated';
}

const DESIGN_TEMPLATE = (specId: string): string =>
  [
    '# Design: ' + specId,
    '',
    '## Overview',
    '',
    'TODO: one or two paragraphs on the chosen approach.',
    '',
    '## Decisions',
    '',
    '- TODO: list significant decisions. Use ADR-style wording when a decision has long-term consequences.',
    '',
    '## Open Questions',
    '',
    '- TODO: things that must be resolved before implementation.',
    '',
  ].join('\n');

export function specPlan(cwd: string, specIdOrName: string): SpecPlanResult {
  const specDir = findSpecDir(cwd, specIdOrName);
  if (!specDir) throw new SpecWorkflowError('E_SPEC_NOT_FOUND', `No spec matches: ${specIdOrName}`);
  const reqRaw = readFileSync(join(specDir, REQUIREMENTS_FILE), 'utf8');
  const parsed = parseRequirements(reqRaw);
  if (parsed.frontmatter.status === 'draft') {
    throw new SpecWorkflowError(
      'E_SPEC_NOT_APPROVED',
      `Spec ${parsed.frontmatter.id} is still a draft. Run \`specgate spec approve ${parsed.frontmatter.id}\` first.`,
    );
  }
  const designPath = join(specDir, DESIGN_FILE);
  if (existsSync(designPath)) {
    return { specDir, designPath, action: 'validated' };
  }
  writeFileSync(designPath, DESIGN_TEMPLATE(parsed.frontmatter.id), 'utf8');
  return { specDir, designPath, action: 'created' };
}

/* ------------------------------ spec tasks ----------------------------- */

export interface SpecTasksResult {
  readonly specDir: string;
  readonly tasksPath: string;
  readonly metaPath: string;
  readonly action: 'created' | 'validated';
  readonly specSha256: string;
}

/**
 * Deterministic hash of the parsed requirements (not the raw file bytes, so
 * cosmetic whitespace changes don't invalidate `tasks.meta.json`).
 */
export function computeSpecHash(parsed: ParsedRequirementsT): string {
  const canonical = JSON.stringify({
    id: parsed.frontmatter.id,
    requirements: parsed.requirements.map((r) => ({
      id: r.id,
      title: r.title,
      deprecated: r.deprecated,
      ac: r.acceptanceCriteria.map((a) => ({ id: a.id, text: a.text, deprecated: a.deprecated })),
    })),
    nfr: parsed.nonFunctional.map((n) => ({ id: n.id, text: n.text })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

const TASKS_TEMPLATE = (parsed: ParsedRequirementsT): string => {
  const lines = ['## Tasks', ''];
  let t = 1;
  for (const req of parsed.requirements) {
    if (req.deprecated) continue;
    for (const ac of req.acceptanceCriteria) {
      if (ac.deprecated) continue;
      const taskId = `T-${String(t).padStart(3, '0')}`;
      lines.push(`- [ ] **${taskId}** TODO: implement ${ac.id} — implements: ${ac.id}`);
      t += 1;
    }
  }
  if (t === 1) lines.push('- [ ] **T-001** TODO: define the first task — implements: AC-xxx.y');
  lines.push('');
  return lines.join('\n');
};

/** Validate that every task's `implements:` ids exist in the parsed spec. */
export function validateTaskLinks(
  parsed: ParsedRequirementsT,
  tasksRaw: string,
): ValidationIssue[] {
  const specAcIds = new Set<string>();
  for (const r of parsed.requirements) for (const ac of r.acceptanceCriteria) specAcIds.add(ac.id);
  const tasks = parseTasks(tasksRaw);
  const issues: ValidationIssue[] = [];
  for (const t of tasks.tasks) {
    for (const ac of t.implements) {
      if (!specAcIds.has(ac)) {
        issues.push({
          code: 'E_ORPHAN_TASK_LINK' as unknown as ValidationIssue['code'],
          id: t.id,
          message: `Task ${t.id} references ${ac}, which does not exist in ${parsed.frontmatter.id}.`,
        });
      }
    }
  }
  return issues;
}

export function specTasks(options: {
  readonly cwd: string;
  readonly specIdOrName: string;
  readonly now?: () => Date;
}): SpecTasksResult {
  const specDir = findSpecDir(options.cwd, options.specIdOrName);
  if (!specDir)
    throw new SpecWorkflowError('E_SPEC_NOT_FOUND', `No spec matches: ${options.specIdOrName}`);
  const reqRaw = readFileSync(join(specDir, REQUIREMENTS_FILE), 'utf8');
  const parsed = parseRequirements(reqRaw);
  if (parsed.frontmatter.status === 'draft') {
    throw new SpecWorkflowError(
      'E_SPEC_NOT_APPROVED',
      `Spec ${parsed.frontmatter.id} is still a draft. Run approve first.`,
    );
  }
  const tasksPath = join(specDir, TASKS_FILE);
  const metaPath = join(specDir, TASKS_META_FILE);
  const specSha256 = computeSpecHash(parsed);

  if (existsSync(tasksPath)) {
    const tasksRaw = readFileSync(tasksPath, 'utf8');
    const linkIssues = validateTaskLinks(parsed, tasksRaw);
    if (linkIssues.length > 0) {
      throw new SpecWorkflowError(
        'E_ORPHAN_TASK_LINK',
        linkIssues.map((i) => `  [${i.code}] ${i.message}`).join('\n'),
      );
    }
    return { specDir, tasksPath, metaPath, action: 'validated', specSha256 };
  }

  // Create from template; also write meta.
  const body = TASKS_TEMPLATE(parsed);
  writeFileSync(tasksPath, body, 'utf8');
  const now = (options.now ?? (() => new Date()))();
  const meta = {
    specId: parsed.frontmatter.id,
    specSha256,
    generatedAt: now.toISOString(),
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  return { specDir, tasksPath, metaPath, action: 'created', specSha256 };
}

/* ------------------- bookkeeping used by the CLI ----------------------- */

export interface SpecSummary {
  readonly specId: string;
  readonly title: string;
  readonly status: 'draft' | 'approved' | 'implemented';
  readonly dir: string;
  readonly createdDate: string;
}

export function listSpecs(cwd: string): SpecSummary[] {
  const dirs = listSpecDirs(cwd);
  const specsRoot = resolve(cwd, SPECS_RELDIR);
  const out: SpecSummary[] = [];
  for (const d of dirs) {
    const reqPath = join(specsRoot, d, REQUIREMENTS_FILE);
    if (!existsSync(reqPath)) continue;
    try {
      const parsed = parseRequirements(readFileSync(reqPath, 'utf8'));
      out.push({
        specId: parsed.frontmatter.id,
        title: parsed.frontmatter.title,
        status: parsed.frontmatter.status,
        dir: join(specsRoot, d),
        createdDate: parsed.frontmatter.created,
      });
    } catch {
      out.push({
        specId: '(unparseable)',
        title: basename(d),
        status: 'draft',
        dir: join(specsRoot, d),
        createdDate: '',
      });
    }
  }
  return out;
}

/** Expose this for the CLI banner. */
export { nextId };
