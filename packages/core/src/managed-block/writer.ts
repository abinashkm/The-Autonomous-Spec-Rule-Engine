import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BEGIN, END } from './markers.js';

/**
 * Writes or replaces a managed block inside a shared file.
 *
 * Source of truth: run.md §6 + §22.8 — only touch bytes between the markers.
 *
 * Behaviour (M1.C.2):
 *  (a) new file + createIfMissing → create with just the block
 *  (b) existing file WITH markers → replace content between them
 *  (c) existing file WITHOUT markers + createIfMissing: false → throw
 *  (d) existing file WITHOUT markers + createIfMissing: true → append the
 *      block to the file, preceded by a blank line separator
 *  Repeated calls with the same input produce byte-identical files.
 *
 * The managed section ALWAYS appears as:
 *     <!-- specgate:begin -->
 *     <content, exactly as provided, with trailing newline normalized>
 *     <!-- specgate:end -->
 */

export interface WriteManagedBlockOptions {
  readonly createIfMissing?: boolean;
  /** Line separator to use when writing. Default: honour the existing file;
   *  for new files, '\n'. */
  readonly eol?: '\n' | '\r\n';
}

export interface WriteManagedBlockResult {
  readonly path: string;
  readonly action: 'created' | 'replaced' | 'appended' | 'unchanged';
}

export class ManagedBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedBlockError';
  }
}

function detectEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function renderBlock(content: string, eol: '\n' | '\r\n'): string {
  const trimmed = content.replace(/[\r\n]+$/u, '');
  return [BEGIN, trimmed, END].join(eol);
}

/** Escape a literal string for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find a marker on its own line. We require the marker to be at the start of
 * a line (BOL or start-of-file) and followed by newline or end-of-file. This
 * is critical because rendered content may contain the literal marker string
 * as prose (e.g. "edit only within <!-- specgate:begin --> markers").
 */
function findLineMarker(text: string, marker: string): number {
  const re = new RegExp(`(?:^|\\r?\\n)${escapeRe(marker)}(?=\\r?\\n|$)`);
  const m = re.exec(text);
  if (!m) return -1;
  // The regex matches an optional leading newline; return the index of the
  // marker string itself.
  return m.index + (m[0].startsWith(marker) ? 0 : m[0].length - marker.length);
}

export function writeManagedBlock(
  filePath: string,
  content: string,
  options: WriteManagedBlockOptions = {},
): WriteManagedBlockResult {
  const createIfMissing = options.createIfMissing ?? false;

  if (!existsSync(filePath)) {
    if (!createIfMissing) {
      throw new ManagedBlockError(
        `File does not exist: ${filePath}. Pass createIfMissing: true to create it.`,
      );
    }
    const eol = options.eol ?? '\n';
    mkdirSync(dirname(filePath), { recursive: true });
    const next = renderBlock(content, eol) + eol;
    writeFileSync(filePath, next, 'utf8');
    return { path: filePath, action: 'created' };
  }

  const existing = readFileSync(filePath, 'utf8');
  const eol = options.eol ?? detectEol(existing);
  const beginIdx = findLineMarker(existing, BEGIN);
  const endIdx = findLineMarker(existing, END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // Replace existing block.
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + END.length);
    const next = before + renderBlock(content, eol) + after;
    if (next === existing) return { path: filePath, action: 'unchanged' };
    writeFileSync(filePath, next, 'utf8');
    return { path: filePath, action: 'replaced' };
  }

  if (beginIdx === -1 && endIdx === -1) {
    if (!createIfMissing) {
      throw new ManagedBlockError(
        `File has no SpecGate markers and createIfMissing is false: ${filePath}`,
      );
    }
    // Append block, with a blank line between existing content and the block.
    const needsNewline = !existing.endsWith(eol);
    const sep = (needsNewline ? eol : '') + eol;
    const next = existing + sep + renderBlock(content, eol) + eol;
    writeFileSync(filePath, next, 'utf8');
    return { path: filePath, action: 'appended' };
  }

  // Only one marker present → the file is corrupt from SpecGate's point of view.
  throw new ManagedBlockError(
    `File has only one of the two SpecGate markers: ${filePath}. Fix manually or delete and re-run.`,
  );
}

/**
 * Return the current managed-block content (between markers) or null.
 * Useful for tests and `specgate uninstall`.
 */
export function readManagedBlock(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, 'utf8');
  const beginIdx = findLineMarker(text, BEGIN);
  const endIdx = findLineMarker(text, END);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) return null;
  const inner = text.slice(beginIdx + BEGIN.length, endIdx);
  return inner.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '');
}

/**
 * Remove the managed block (and the surrounding separator newlines if the
 * block was the only content). Used by `specgate uninstall` (M8).
 */
export function removeManagedBlock(filePath: string): 'removed' | 'absent' {
  if (!existsSync(filePath)) return 'absent';
  const text = readFileSync(filePath, 'utf8');
  const beginIdx = findLineMarker(text, BEGIN);
  const endIdx = findLineMarker(text, END);
  if (beginIdx === -1 || endIdx === -1) return 'absent';
  const before = text.slice(0, beginIdx).replace(/[\r\n]+$/, '');
  const after = text.slice(endIdx + END.length).replace(/^[\r\n]+/, '');
  const next = [before, after].filter((s) => s.length > 0).join(detectEol(text) + detectEol(text));
  writeFileSync(filePath, next + (next.length > 0 ? detectEol(text) : ''), 'utf8');
  return 'removed';
}
