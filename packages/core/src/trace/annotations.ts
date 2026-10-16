import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * AC-id annotation parsers.
 * Source of truth: run.md §12.1.
 *
 * We scan test files for AC references by regex. Three dialects:
 *   JS/TS   — `@spec AC-xxx.y` in comments; `it("AC-xxx.y: ...", ...)` names;
 *             `describe("AC-xxx.y", ...)` names.
 *   Python  — `@spec AC-xxx.y` in comments; `def test_AC_xxx_y_...` names;
 *             `@pytest.mark.spec("AC-xxx.y")` decorators.
 *   Go      — `@spec AC-xxx.y` in comments; `func Test_ACxxxY...` names.
 *
 * The parser returns one `AnnotationHit` per occurrence (dedup is a caller
 * concern — the traceability index keys by `(file, acId)`).
 */

export interface AnnotationHit {
  readonly file: string; // repo-relative, POSIX separators
  readonly line: number;
  readonly acId: string; // e.g. "AC-001.1"
  readonly testName: string | null; // when the hit was inside an it()/def
  readonly source: 'comment' | 'test-name' | 'pytest-mark';
}

export type Language = 'ts' | 'js' | 'python' | 'go';

const AC_RE = /\bAC-(\d{3})\.(\d+)\b/g;

const COMMENT_AC_RE = /\bAC-\d{3}\.\d+\b/g;
const JS_TEST_NAME_RE = /\b(?:it|test|describe)\s*\(\s*(['"`])\s*(AC-\d{3}\.\d+)[^'"`]*\1/g;
const PY_PYTEST_MARK_RE = /@pytest\.mark\.spec\(\s*(['"])(AC-\d{3}\.\d+)\1\s*\)/g;
const PY_DEF_RE = /^\s*def\s+test_(?:AC_)?(\d{3})_(\d+)[^(]*\(/gm;
const GO_FUNC_RE = /^\s*func\s+Test_?AC_?(\d{3})_?(\d+)[A-Za-z0-9_]*\s*\(/gm;

const JS_TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts|cjs|mjs)$/;
const PY_TEST_FILE_RE = /(^|[/\\])(test_[^/\\]+|[^/\\]+_test)\.py$/;
const GO_TEST_FILE_RE = /_test\.go$/;

export function detectLanguage(path: string): Language | null {
  if (JS_TEST_FILE_RE.test(path)) return path.endsWith('x') ? 'ts' : 'ts';
  if (PY_TEST_FILE_RE.test(path)) return 'python';
  if (GO_TEST_FILE_RE.test(path)) return 'go';
  if (/\.(ts|tsx|js|jsx)$/.test(path)) return 'ts';
  if (/\.py$/.test(path)) return 'python';
  if (/\.go$/.test(path)) return 'go';
  return null;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

function pushCommentHits(text: string, out: AnnotationHit[], file: string): void {
  for (const m of text.matchAll(COMMENT_AC_RE)) {
    const idx = m.index ?? 0;
    const line = lineOf(text, idx);
    // Only count as `comment` when the hit is inside a `//`, `#`, or `/* */`
    // comment context. Cheap check: look back on the same line for a comment
    // starter; or allow if the surrounding is inside a block comment (we
    // approximate by scanning back a few hundred chars for `/*`).
    const sol = text.lastIndexOf('\n', idx - 1) + 1;
    const lineText = text.slice(sol, idx);
    const hasLineComment = /(?:^|[^:])\/\/|^\s*#/.test(lineText);
    if (hasLineComment) {
      out.push({ file, line, acId: m[0], testName: null, source: 'comment' });
      continue;
    }
    // crude block-comment detection
    const blockStart = text.lastIndexOf('/*', idx);
    const blockEnd = text.lastIndexOf('*/', idx);
    if (blockStart > blockEnd) {
      out.push({ file, line, acId: m[0], testName: null, source: 'comment' });
    }
  }
}

/** Parse a JS/TS file (works for test and non-test files). */
export function parseJsTs(file: string, text: string): AnnotationHit[] {
  const out: AnnotationHit[] = [];
  pushCommentHits(text, out, file);
  for (const m of text.matchAll(JS_TEST_NAME_RE)) {
    const idx = m.index ?? 0;
    out.push({
      file,
      line: lineOf(text, idx),
      acId: m[2]!,
      testName: m[2]!,
      source: 'test-name',
    });
  }
  return out;
}

/** Parse a Python file. */
export function parsePython(file: string, text: string): AnnotationHit[] {
  const out: AnnotationHit[] = [];
  pushCommentHits(text, out, file);
  for (const m of text.matchAll(PY_PYTEST_MARK_RE)) {
    const idx = m.index ?? 0;
    out.push({
      file,
      line: lineOf(text, idx),
      acId: m[2]!,
      testName: null,
      source: 'pytest-mark',
    });
  }
  for (const m of text.matchAll(PY_DEF_RE)) {
    const idx = m.index ?? 0;
    const acId = `AC-${m[1]!}.${m[2]!}`;
    out.push({
      file,
      line: lineOf(text, idx),
      acId,
      testName: acId,
      source: 'test-name',
    });
  }
  return out;
}

/** Parse a Go file. */
export function parseGo(file: string, text: string): AnnotationHit[] {
  const out: AnnotationHit[] = [];
  pushCommentHits(text, out, file);
  for (const m of text.matchAll(GO_FUNC_RE)) {
    const idx = m.index ?? 0;
    const acId = `AC-${m[1]!}.${m[2]!}`;
    out.push({
      file,
      line: lineOf(text, idx),
      acId,
      testName: acId,
      source: 'test-name',
    });
  }
  return out;
}

export function parseByLanguage(language: Language, file: string, text: string): AnnotationHit[] {
  switch (language) {
    case 'ts':
    case 'js':
      return parseJsTs(file, text);
    case 'python':
      return parsePython(file, text);
    case 'go':
      return parseGo(file, text);
  }
}

/* ----------------------------- repo walker ----------------------------- */

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.specgate',
  '.venv',
  '__pycache__',
]);

export interface ScanOptions {
  readonly includeNonTestFiles?: boolean;
  readonly maxFileBytes?: number;
}

/**
 * Walk the repo under `cwd`, parse all test files (and optionally non-test
 * source files for inline `@spec` comments), and return every `AnnotationHit`.
 */
export function scanRepoForAcAnnotations(cwd: string, options: ScanOptions = {}): AnnotationHit[] {
  const absRoot = resolve(cwd);
  const maxBytes = options.maxFileBytes ?? 1024 * 1024;
  const includeAll = options.includeNonTestFiles ?? true;
  const out: AnnotationHit[] = [];

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (SKIP_DIRS.has(ent.name)) continue;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      const relPosix = relative(absRoot, abs).split('\\').join('/');
      const isTest =
        JS_TEST_FILE_RE.test(relPosix) ||
        PY_TEST_FILE_RE.test(relPosix) ||
        GO_TEST_FILE_RE.test(relPosix);
      if (!isTest && !includeAll) continue;
      const lang = detectLanguage(relPosix);
      if (!lang) continue;
      try {
        const size = statSync(abs).size;
        if (size > maxBytes) continue;
      } catch {
        continue;
      }
      let text: string;
      try {
        text = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      // Quick skip: no AC- ids at all.
      if (!AC_RE.test(text)) {
        AC_RE.lastIndex = 0;
        continue;
      }
      AC_RE.lastIndex = 0;
      out.push(...parseByLanguage(lang, relPosix, text));
    }
  };
  walk(absRoot);
  // Deterministic order.
  out.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    return a.acId.localeCompare(b.acId);
  });
  return out;
}
