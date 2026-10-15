/**
 * Spec ID helpers.
 * Source of truth: run.md §7.1 — "IDs are unique, immutable once approved;
 * never renumber. Removed items are marked ~~deprecated~~, not deleted."
 */

export type IdPrefix = 'REQ' | 'AC' | 'T' | 'NFR' | 'SPEC';

const ID_PATTERNS: Record<IdPrefix, RegExp> = {
  REQ: /^REQ-(\d{3})$/,
  AC: /^AC-(\d{3})\.(\d+)$/,
  T: /^T-(\d{3})$/,
  NFR: /^NFR-(\d{3})$/,
  SPEC: /^SPEC-(\d{3})$/,
};

export function isValidId(prefix: IdPrefix, id: string): boolean {
  return ID_PATTERNS[prefix].test(id);
}

/**
 * Compute the next unused numeric id for the prefix given the existing ids.
 * Never fills gaps — matches the §7.1 "never renumber" rule.
 *
 * `AC` is special-cased: ACs are numbered within a REQ as `AC-<req>.<n>`.
 */
export function nextId(prefix: 'REQ' | 'T' | 'NFR' | 'SPEC', existing: readonly string[]): string {
  const re = ID_PATTERNS[prefix];
  let max = 0;
  for (const id of existing) {
    const m = re.exec(id);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  const next = (max + 1).toString().padStart(3, '0');
  return `${prefix}-${next}`;
}

/** Next AC id within a specific REQ. e.g. `nextAcId('REQ-001', ['AC-001.1'])` → 'AC-001.2'. */
export function nextAcId(reqId: string, existing: readonly string[]): string {
  const reqMatch = /^REQ-(\d{3})$/.exec(reqId);
  if (!reqMatch) throw new Error(`nextAcId: not a REQ id: ${reqId}`);
  const prefix = `AC-${reqMatch[1]}`;
  let max = 0;
  for (const id of existing) {
    if (!id.startsWith(prefix + '.')) continue;
    const n = Number(id.slice(prefix.length + 1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}.${max + 1}`;
}
