import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ParsedRequirements as ParsedRequirementsT } from '../schemas/spec.js';

/**
 * Spec validation.
 * Source of truth: run.md §7.1 + §22.
 *
 * Error codes (stable; consumed by the CLI and MCP tools):
 *   E_DUP_ID               — the same id appears twice.
 *   E_EMPTY_AC             — an AC body is empty / whitespace-only.
 *   E_UNTESTABLE_AC        — an AC is too short to be a testable statement
 *                             (fewer than 5 words AND lacks a when/then pattern).
 *   E_BAD_STATUS           — frontmatter.status is not one of the enum.
 *                             (In practice caught earlier by the schema.)
 *   E_IMMUTABLE_REMOVAL    — an approved spec is missing an id that was in
 *                             the committed ids.lock.json (M2.B.3).
 *   E_IMMUTABLE_RENUMBER   — an approved spec reuses an existing id with a
 *                             different body — a form of silent renumber.
 */

export type ValidationCode =
  | 'E_DUP_ID'
  | 'E_EMPTY_AC'
  | 'E_UNTESTABLE_AC'
  | 'E_BAD_STATUS'
  | 'E_IMMUTABLE_REMOVAL'
  | 'E_IMMUTABLE_RENUMBER';

export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly id?: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

const WHEN_THEN_RE = /\b(when|given)\b.*\bthen\b/i;

function isUntestable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  // If it matches Given/When/Then it's testable regardless of length.
  if (WHEN_THEN_RE.test(trimmed)) return false;
  return words.length < 5;
}

export function validateSpec(parsed: ParsedRequirementsT): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  const push = (code: ValidationCode, message: string, id?: string): void => {
    issues.push({ code, message, ...(id ? { id } : {}) });
  };

  for (const req of parsed.requirements) {
    if (seen.has(req.id)) push('E_DUP_ID', `Duplicate requirement id: ${req.id}`, req.id);
    seen.add(req.id);
    for (const ac of req.acceptanceCriteria) {
      if (seen.has(ac.id)) push('E_DUP_ID', `Duplicate id: ${ac.id}`, ac.id);
      seen.add(ac.id);
      if (ac.text.trim().length === 0) {
        push('E_EMPTY_AC', `Acceptance criterion ${ac.id} has an empty body.`, ac.id);
      } else if (!ac.deprecated && isUntestable(ac.text)) {
        push(
          'E_UNTESTABLE_AC',
          `Acceptance criterion ${ac.id} is too short to be testable. Use Given/When/Then or at least 5 words.`,
          ac.id,
        );
      }
    }
  }
  for (const nfr of parsed.nonFunctional) {
    if (seen.has(nfr.id)) push('E_DUP_ID', `Duplicate id: ${nfr.id}`, nfr.id);
    seen.add(nfr.id);
  }

  return { valid: issues.length === 0, issues };
}

/* ---------------- immutability (M2.B.3) ---------------------------------- */

/**
 * Snapshot committed on `specgate spec approve` so later edits can be checked
 * for silent renames or removals. The lock file lives inside the spec dir.
 */
export const IDS_LOCK_FILENAME = 'ids.lock.json';

export interface IdsLock {
  readonly specId: string;
  readonly approvedAt: string; // ISO
  readonly ids: readonly string[]; // every REQ + AC + NFR id at approval
}

export function collectIds(parsed: ParsedRequirementsT): string[] {
  const out = new Set<string>();
  for (const r of parsed.requirements) {
    out.add(r.id);
    for (const ac of r.acceptanceCriteria) out.add(ac.id);
  }
  for (const n of parsed.nonFunctional) out.add(n.id);
  return [...out].sort();
}

export function writeIdsLock(specDir: string, lock: IdsLock): string {
  const abs = join(resolve(specDir), IDS_LOCK_FILENAME);
  mkdirSync(dirname(abs), { recursive: true });
  const body = JSON.stringify(
    { specId: lock.specId, approvedAt: lock.approvedAt, ids: [...lock.ids].sort() },
    null,
    2,
  );
  writeFileSync(abs, body + '\n', 'utf8');
  return abs;
}

export function readIdsLock(specDir: string): IdsLock | null {
  const abs = join(resolve(specDir), IDS_LOCK_FILENAME);
  if (!existsSync(abs)) return null;
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf8')) as IdsLock;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.ids)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Check an approved spec for immutability violations against its stored lock.
 * Rules:
 *   - Any id in the lock that is no longer present in the parsed spec AND is
 *     not marked `~~deprecated~~` → E_IMMUTABLE_REMOVAL.
 *   - Deprecated-marked ids are allowed to stay (§7.1).
 */
export function validateImmutability(
  parsed: ParsedRequirementsT,
  lock: IdsLock,
): ValidationIssue[] {
  const presentIds = new Set<string>();
  const deprecatedIds = new Set<string>();
  for (const r of parsed.requirements) {
    presentIds.add(r.id);
    if (r.deprecated) deprecatedIds.add(r.id);
    for (const ac of r.acceptanceCriteria) {
      presentIds.add(ac.id);
      if (ac.deprecated) deprecatedIds.add(ac.id);
    }
  }
  for (const n of parsed.nonFunctional) presentIds.add(n.id);

  const issues: ValidationIssue[] = [];
  for (const id of lock.ids) {
    if (!presentIds.has(id) && !deprecatedIds.has(id)) {
      issues.push({
        code: 'E_IMMUTABLE_REMOVAL',
        id,
        message: `Approved id ${id} was removed. Mark it as ~~deprecated~~ instead of deleting (run.md §7.1).`,
      });
    }
  }
  return issues;
}
