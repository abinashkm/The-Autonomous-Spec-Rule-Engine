import { run } from '../subprocess/run.js';

/**
 * Git-trailer parser.
 * Source of truth: run.md §12.1 — commits carry `Spec: REQ-xxx[, T-yyy, AC-zzz.n]`
 * trailers that link the commit to spec items.
 *
 * We shell out to `git log --pretty=%H%x00%B%x1e` and split; this is portable
 * across platforms and sidesteps git's `--format` subtleties.
 */

export interface CommitRef {
  readonly sha: string;
  readonly reqIds: readonly string[];
  readonly taskIds: readonly string[];
  readonly acIds: readonly string[];
}

export interface ParseTrailersOptions {
  readonly cwd: string;
  readonly since?: string; // git revision range, e.g. "main..HEAD" or "HEAD~50"
  readonly maxCommits?: number; // safety cap
}

const SPEC_TRAILER_RE = /^Spec:\s*(.+)$/m;
const REQ_RE = /\bREQ-\d{3}\b/g;
const TASK_RE = /\bT-\d{3}\b/g;
const AC_RE = /\bAC-\d{3}\.\d+\b/g;

/**
 * Pure parser — given a commit message body, return the referenced ids.
 * Exported so the MCP tool and tests can use it without `git` installed.
 */
export function parseCommitTrailer(message: string): {
  readonly reqIds: readonly string[];
  readonly taskIds: readonly string[];
  readonly acIds: readonly string[];
} {
  const m = SPEC_TRAILER_RE.exec(message);
  if (!m) return { reqIds: [], taskIds: [], acIds: [] };
  const line = m[1] ?? '';
  const reqIds = [...new Set([...line.matchAll(REQ_RE)].map((x) => x[0]))].sort();
  const taskIds = [...new Set([...line.matchAll(TASK_RE)].map((x) => x[0]))].sort();
  const acIds = [...new Set([...line.matchAll(AC_RE)].map((x) => x[0]))].sort();
  return { reqIds, taskIds, acIds };
}

/**
 * Read commits from git and extract their `Spec:` trailers.
 * Returns [] if git fails (uninitialized repo, no commits, git missing).
 */
export async function parseTrailers(options: ParseTrailersOptions): Promise<CommitRef[]> {
  const args = ['log', '--pretty=%H%x1f%B%x1e'];
  if (options.since) args.push(options.since);
  if (options.maxCommits) args.push(`-n${options.maxCommits}`);

  const r = await run('git', args, { cwd: options.cwd, timeoutMs: 15_000 });
  if (r.exitCode !== 0 || !r.stdout) return [];

  const commits: CommitRef[] = [];
  // Record separator: 0x1e; field separator: 0x1f.
  const records = r.stdout
    .split('\x1e')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const rec of records) {
    const [sha, body = ''] = rec.split('\x1f');
    if (!sha) continue;
    const { reqIds, taskIds, acIds } = parseCommitTrailer(body);
    if (reqIds.length === 0 && taskIds.length === 0 && acIds.length === 0) continue;
    commits.push({ sha: sha.trim(), reqIds, taskIds, acIds });
  }
  return commits;
}
