import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnnotationHit } from './annotations.js';
import { scanRepoForAcAnnotations } from './annotations.js';
import type { CommitRef } from './trailers.js';
import { parseTrailers } from './trailers.js';
import { listSpecs, REQUIREMENTS_FILE, TASKS_FILE } from '../spec/workflow.js';
import { parseRequirements, parseTasks } from '../spec/parse.js';
import type {
  AcceptanceCriterion as AcceptanceCriterionT,
  TaskRow as TaskRowT,
} from '../schemas/spec.js';

/**
 * Traceability graph.
 * Source of truth: run.md §5.5 + §12.2 ("done" definition).
 *
 * Nodes:
 *   REQ ─┬─ AC ─┬─ Task
 *        │      └─ Test (annotation hits)
 *        └─ Commit (via trailer)
 *
 * Edges:
 *   REQ → AC         (from spec)
 *   AC → Task        (tasks.md `implements:`)
 *   AC → Test        (annotation hits)
 *   REQ/AC → Commit  (git trailers)
 */

export type AcStatus = 'untested' | 'failing' | 'passing' | 'done';

export interface AcNode {
  readonly id: string;
  readonly reqId: string;
  readonly text: string;
  deprecated: boolean;
  tasks: string[];
  tests: AnnotationHit[];
  commits: string[];
}

export interface ReqNode {
  readonly id: string;
  readonly specId: string;
  readonly title: string;
  readonly deprecated: boolean;
  acs: string[]; // AC ids
}

export interface TaskNode extends TaskRowT {
  readonly specId: string;
  readonly specDir: string;
}

export interface OrphanTest {
  readonly file: string;
  readonly line: number;
  readonly acId: string; // referenced but not present in any spec
}

export interface TraceabilityGraph {
  readonly reqs: Record<string, ReqNode>;
  readonly acs: Record<string, AcNode>;
  readonly tasks: Record<string, TaskNode>;
  readonly orphans: readonly OrphanTest[];
}

export interface BuildIndexOptions {
  readonly cwd: string;
  /** Pass a precomputed set of passing tests. The traceability layer does not
   *  run tests itself — the `tests` gate does. When omitted, we treat every
   *  linked test as "potentially passing" (used by `status` without a run). */
  readonly passingTests?: ReadonlyArray<{
    readonly file: string;
    readonly testName?: string | null;
  }>;
  /** Pass a precomputed set of failing tests (file + optional testName). */
  readonly failingTests?: ReadonlyArray<{
    readonly file: string;
    readonly testName?: string | null;
  }>;
}

export async function buildTraceabilityIndex(
  options: BuildIndexOptions,
): Promise<TraceabilityGraph> {
  const cwd = options.cwd;
  const reqs: Record<string, ReqNode> = {};
  const acs: Record<string, AcNode> = {};
  const tasks: Record<string, TaskNode> = {};

  for (const spec of listSpecs(cwd)) {
    const reqPath = join(spec.dir, REQUIREMENTS_FILE);
    if (!existsSync(reqPath)) continue;
    let parsedReqs;
    try {
      parsedReqs = parseRequirements(readFileSync(reqPath, 'utf8'));
    } catch {
      continue;
    }
    for (const r of parsedReqs.requirements) {
      const acIds = r.acceptanceCriteria.map((a) => a.id);
      reqs[r.id] = {
        id: r.id,
        specId: parsedReqs.frontmatter.id,
        title: r.title,
        deprecated: r.deprecated,
        acs: acIds,
      };
      for (const ac of r.acceptanceCriteria) {
        acs[ac.id] = freshAcNode(ac, r.id);
      }
    }
    const tasksPath = join(spec.dir, TASKS_FILE);
    if (existsSync(tasksPath)) {
      try {
        const parsedTasks = parseTasks(readFileSync(tasksPath, 'utf8'));
        for (const t of parsedTasks.tasks) {
          tasks[t.id] = { ...t, specId: parsedReqs.frontmatter.id, specDir: spec.dir };
          for (const acId of t.implements) {
            const ac = acs[acId];
            if (ac) ac.tasks.push(t.id);
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  const annotations = scanRepoForAcAnnotations(cwd);
  const orphans: OrphanTest[] = [];
  for (const hit of annotations) {
    const ac = acs[hit.acId];
    if (ac) ac.tests.push(hit);
    else orphans.push({ file: hit.file, line: hit.line, acId: hit.acId });
  }

  let commits: CommitRef[] = [];
  try {
    commits = await parseTrailers({ cwd, maxCommits: 500 });
  } catch {
    /* git unavailable */
  }
  for (const c of commits) {
    for (const acId of c.acIds) {
      const ac = acs[acId];
      if (ac) ac.commits.push(c.sha);
    }
    for (const reqId of c.reqIds) {
      const req = reqs[reqId];
      if (!req) continue;
      for (const acId of req.acs) {
        const ac = acs[acId];
        if (ac) ac.commits.push(c.sha);
      }
    }
  }

  // Dedupe + sort for determinism.
  for (const ac of Object.values(acs)) {
    ac.tasks = [...new Set(ac.tasks)].sort();
    ac.commits = [...new Set(ac.commits)].sort();
    ac.tests = [...ac.tests].sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
    );
  }

  return { reqs, acs, tasks, orphans };
}

function freshAcNode(ac: AcceptanceCriterionT, reqId: string): AcNode {
  return {
    id: ac.id,
    reqId,
    text: ac.text,
    deprecated: ac.deprecated,
    tasks: [],
    tests: [],
    commits: [],
  };
}

/**
 * "Done" rule per run.md §12.2:
 *   AC done ⇔ (≥1 linked test) ∧ (that test is in the last passing run)
 *            ∧ (every linked task is checked)
 *
 * The three inputs are:
 *   - `ac.tests.length > 0`
 *   - either an explicit `passingTests` set (containing the test's file +
 *     optional testName) OR, when neither passingTests nor failingTests was
 *     supplied, we treat `tests > 0` as "potentially passing".
 *   - every task that `implements` this AC is `done: true`.
 */
export function isAcDone(
  graph: TraceabilityGraph,
  acId: string,
  options: {
    readonly passingTests?: BuildIndexOptions['passingTests'];
    readonly failingTests?: BuildIndexOptions['failingTests'];
  } = {},
): AcStatus {
  const ac = graph.acs[acId];
  if (!ac) return 'untested';
  if (ac.deprecated) return 'done';
  if (ac.tests.length === 0) return 'untested';

  // 1. Fail-fast on failing tests regardless of task state.
  const failing = options.failingTests ?? [];
  for (const test of ac.tests) {
    for (const f of failing) {
      if (f.file === test.file && (f.testName == null || f.testName === test.testName)) {
        return 'failing';
      }
    }
  }

  // 2. When a passingTests set is supplied, require coverage of every linked test.
  const passing = options.passingTests ?? [];
  if (passing.length > 0) {
    const covered = ac.tests.every((t) =>
      passing.some((p) => p.file === t.file && (p.testName == null || p.testName === t.testName)),
    );
    if (!covered) return 'untested';
  }

  // 3. If any linked task is still open, the AC is tested-but-not-yet-done
  //    (status "passing"). Otherwise it's fully done.
  const anyTaskUnchecked = ac.tasks.some((tid) => {
    const t = graph.tasks[tid];
    return t ? !t.done : true;
  });
  if (ac.tasks.length > 0 && anyTaskUnchecked) return 'passing';
  return ac.tasks.length === 0 ? 'passing' : 'done';
}

/* ------------------------------- status API --------------------------- */

export interface StatusMatrix {
  readonly reqs: ReadonlyArray<{
    readonly reqId: string;
    readonly title: string;
    readonly deprecated: boolean;
    readonly acs: ReadonlyArray<{
      readonly acId: string;
      readonly text: string;
      readonly status: AcStatus;
      readonly tests: readonly AnnotationHit[];
      readonly tasks: readonly string[];
    }>;
  }>;
  readonly orphanTests: readonly OrphanTest[];
  readonly summary: {
    readonly total: number;
    readonly passing: number;
    readonly failing: number;
    readonly untested: number;
    readonly done: number;
  };
}

export function buildStatusMatrix(
  graph: TraceabilityGraph,
  options: Parameters<typeof isAcDone>[2] = {},
): StatusMatrix {
  const reqs: StatusMatrix['reqs'] = Object.values(graph.reqs)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((req) => ({
      reqId: req.id,
      title: req.title,
      deprecated: req.deprecated,
      acs: [...req.acs]
        .sort((a: string, b: string) => a.localeCompare(b))
        .map((acId: string) => {
          const ac = graph.acs[acId]!;
          const status = isAcDone(graph, acId, options);
          return {
            acId,
            text: ac.text,
            status,
            tests: ac.tests,
            tasks: ac.tasks,
          };
        }),
    }));
  const summary = {
    total: 0,
    passing: 0,
    failing: 0,
    untested: 0,
    done: 0,
  };
  for (const r of reqs)
    for (const ac of r.acs) {
      summary.total++;
      summary[ac.status]++;
    }
  return { reqs, orphanTests: graph.orphans, summary };
}

export * from './trailers.js';
export * from './annotations.js';
