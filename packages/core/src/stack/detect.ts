import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep, posix } from 'node:path';
import {
  StackProfile,
  emptyStackProfile,
  type StackProfile as StackProfileT,
  type DetectedField,
} from '../schemas/stack-profile.js';
import { SIGNATURES, type StackAxis } from './signatures.js';

/**
 * Stack detector. Reads the repo tree top-N levels, matches files against the
 * signature table, and aggregates per-axis values + confidence.
 *
 * Source of truth: run.md §5.1.
 *
 * Design:
 *   - Walks a shallow tree (default depth 3) so detection stays fast.
 *   - Ignores `node_modules`, `.git`, `dist`, `.venv`, `__pycache__` by default.
 *   - Content probes read the file ONCE (cached) when triggered.
 *   - No network calls; this is enforced by not importing any network APIs.
 */

export interface DetectOptions {
  /** Max directory depth to walk. Default 3. */
  readonly maxDepth?: number;
  /** Directory names to skip entirely. */
  readonly skipDirs?: readonly string[];
  /** Max bytes to read per file for content probes. */
  readonly maxFileBytes?: number;
  /** Pin `detectedAt` for deterministic tests. */
  readonly now?: () => Date;
}

const DEFAULT_SKIP = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.turbo',
  '.cache',
  '.pnpm-store',
];

/** Convert a Windows path to POSIX for glob matching. */
function toPosix(p: string): string {
  return p.split(sep).join(posix.sep);
}

/**
 * Minimal glob matcher. Supports:
 *   - exact segments
 *   - `*` within a segment
 *   - `**` as its own segment (zero-or-more directories)
 *
 * This is intentionally not a general-purpose matcher; see signature patterns.
 */
export function globMatch(pattern: string, path: string): boolean {
  const pSegs = pattern.split('/').filter((s) => s.length > 0);
  const tSegs = path.split('/').filter((s) => s.length > 0);
  return matchSegs(pSegs, 0, tSegs, 0);
}

function matchSegs(p: string[], pi: number, t: string[], ti: number): boolean {
  if (pi === p.length) return ti === t.length;
  const seg = p[pi]!;
  if (seg === '**') {
    // zero-or-more segments: try matching tail at each position.
    for (let k = ti; k <= t.length; k++) {
      if (matchSegs(p, pi + 1, t, k)) return true;
    }
    return false;
  }
  if (ti === t.length) return false;
  if (!segmentMatches(seg, t[ti]!)) return false;
  return matchSegs(p, pi + 1, t, ti + 1);
}

function segmentMatches(pattern: string, text: string): boolean {
  if (!pattern.includes('*')) return pattern === text;
  // Translate single-segment glob to regex.
  const re = new RegExp(
    '^' +
      pattern
        .split('')
        .map((ch) => (ch === '*' ? '.*' : ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$',
  );
  return re.test(text);
}

interface Walked {
  readonly relPosix: string;
  readonly abs: string;
}

function walk(
  root: string,
  opts: Required<Pick<DetectOptions, 'maxDepth' | 'skipDirs'>>,
): Walked[] {
  const out: Walked[] = [];
  const skip = new Set(opts.skipDirs);

  function recurse(dir: string, depth: number): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name === '.git') continue; // always skip .git
      if (skip.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < opts.maxDepth) recurse(abs, depth + 1);
      } else if (entry.isFile()) {
        const relFromRoot = relative(root, abs);
        out.push({ relPosix: toPosix(relFromRoot), abs });
      }
    }
  }

  recurse(root, 0);
  return out;
}

interface Hit {
  readonly axis: StackAxis;
  readonly value: string;
  readonly weight: number;
  readonly signatureId: string;
}

function fileText(abs: string, maxBytes: number): string | null {
  try {
    const stats = statSync(abs);
    if (stats.size > maxBytes) return null;
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function matchSignatures(files: readonly Walked[], maxFileBytes: number): Hit[] {
  const hits: Hit[] = [];
  const contentCache = new Map<string, string | null>();

  for (const sig of SIGNATURES) {
    for (const file of files) {
      if (!globMatch(sig.filePattern, file.relPosix)) continue;
      if (sig.contentProbe) {
        let text = contentCache.get(file.abs);
        if (text === undefined) {
          text = fileText(file.abs, maxFileBytes);
          contentCache.set(file.abs, text);
        }
        if (text === null || !sig.contentProbe.test(text)) continue;
      }
      hits.push({ axis: sig.axis, value: sig.value, weight: sig.weight, signatureId: sig.id });
    }
  }
  return hits;
}

type ArrayAxis = Exclude<StackAxis, 'ciProvider'>;

function aggregateArrayAxis(hits: readonly Hit[], axis: ArrayAxis): DetectedField {
  const perValue = new Map<string, number>();
  for (const h of hits) {
    if (h.axis !== axis) continue;
    perValue.set(h.value, (perValue.get(h.value) ?? 0) + h.weight);
  }
  const values = [...perValue.keys()].sort();
  // Overall axis confidence = clamp(sum of each distinct value's best weight).
  // Using sum of per-value max weights (we already summed above, so use the
  // highest contribution across values as the lower bound and sum as upper
  // bound capped at 1).
  const totalWeight = [...perValue.values()].reduce((a, b) => a + b, 0);
  const confidence = Math.min(1, Number(totalWeight.toFixed(2)));
  return { values, confidence };
}

function aggregateCiProvider(hits: readonly Hit[]): StackProfileT['ciProvider'] {
  // Pick the single highest-weight CI provider.
  let best: { value: string; weight: number } | null = null;
  for (const h of hits) {
    if (h.axis !== 'ciProvider') continue;
    if (!best || h.weight > best.weight) best = { value: h.value, weight: h.weight };
  }
  if (!best) return { value: null, confidence: 0 };
  return { value: best.value, confidence: Math.min(1, best.weight) };
}

export async function detectStack(
  rootPath: string,
  options: DetectOptions = {},
): Promise<StackProfileT> {
  const absRoot = resolve(rootPath);
  if (!existsSync(absRoot)) {
    throw new Error(`detectStack: path does not exist: ${absRoot}`);
  }
  const now = (options.now ?? (() => new Date()))();
  const maxDepth = options.maxDepth ?? 3;
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP;
  const maxFileBytes = options.maxFileBytes ?? 256 * 1024;

  const files = walk(absRoot, { maxDepth, skipDirs });
  const hits = matchSignatures(files, maxFileBytes);

  const profile: StackProfileT = {
    ...emptyStackProfile(absRoot, now.toISOString()),
    languages: aggregateArrayAxis(hits, 'languages'),
    frameworks: aggregateArrayAxis(hits, 'frameworks'),
    packageManagers: aggregateArrayAxis(hits, 'packageManagers'),
    testRunners: aggregateArrayAxis(hits, 'testRunners'),
    linters: aggregateArrayAxis(hits, 'linters'),
    ciProvider: aggregateCiProvider(hits),
  };

  return StackProfile.parse(profile);
}

/** Apply a user override (run.md §5.1 "user can override in config"). */
export function applyStackOverride(
  profile: StackProfileT,
  override: {
    languages?: string[];
    frameworks?: string[];
    packageManagers?: string[];
    testRunners?: string[];
    linters?: string[];
    ciProvider?: string;
  },
): StackProfileT {
  const copy = structuredClone(profile) as StackProfileT;
  if (override.languages) copy.languages = { values: [...override.languages], confidence: 1 };
  if (override.frameworks) copy.frameworks = { values: [...override.frameworks], confidence: 1 };
  if (override.packageManagers)
    copy.packageManagers = { values: [...override.packageManagers], confidence: 1 };
  if (override.testRunners) copy.testRunners = { values: [...override.testRunners], confidence: 1 };
  if (override.linters) copy.linters = { values: [...override.linters], confidence: 1 };
  if (override.ciProvider) copy.ciProvider = { value: override.ciProvider, confidence: 1 };
  return copy;
}
