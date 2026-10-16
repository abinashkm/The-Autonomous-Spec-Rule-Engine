import pc from 'picocolors';
import { buildStatusMatrix, buildTraceabilityIndex, type AcStatus } from '@specgate/core';

/**
 * `specgate status` — traceability matrix (run.md §5.5, §12).
 *
 * Flags:
 *   --json           machine-readable output
 *   --untested-only  only show ACs with status 'untested'
 *   --failing-only   only show ACs with status 'failing'
 *   --orphans        show only the orphan-test section (ids referenced by
 *                    tests but absent from any spec)
 */

export interface StatusCommandOptions {
  readonly cwd: string;
  readonly json?: boolean;
  readonly untestedOnly?: boolean;
  readonly failingOnly?: boolean;
  readonly orphans?: boolean;
}

const BADGE: Record<AcStatus, string> = {
  untested: '○',
  failing: '✗',
  passing: '•',
  done: '✓',
};

const COL: Record<AcStatus, (s: string) => string> = {
  untested: pc.gray,
  failing: pc.red,
  passing: pc.yellow,
  done: pc.green,
};

export async function statusCommand(options: StatusCommandOptions): Promise<number> {
  try {
    const graph = await buildTraceabilityIndex({ cwd: options.cwd });
    const matrix = buildStatusMatrix(graph);

    // Filter helpers.
    const wantAll = !options.untestedOnly && !options.failingOnly && !options.orphans;
    const filteredReqs =
      wantAll || options.orphans
        ? matrix.reqs
        : matrix.reqs
            .map((r) => ({
              ...r,
              acs: r.acs.filter((ac) =>
                options.untestedOnly ? ac.status === 'untested' : ac.status === 'failing',
              ),
            }))
            .filter((r) => r.acs.length > 0);

    if (options.json) {
      process.stdout.write(
        JSON.stringify(
          options.orphans
            ? { orphanTests: matrix.orphanTests }
            : { reqs: filteredReqs, orphanTests: matrix.orphanTests, summary: matrix.summary },
          null,
          2,
        ) + '\n',
      );
      return matrix.summary.failing > 0 ? 1 : 0;
    }

    const color = process.stdout.isTTY;
    const paint = (fn: (s: string) => string, s: string): string => (color ? fn(s) : s);

    if (options.orphans) {
      process.stdout.write(paint(pc.bold, 'Orphan tests\n'));
      if (matrix.orphanTests.length === 0) {
        process.stdout.write(paint(pc.gray, '  (none)\n'));
      } else {
        for (const o of matrix.orphanTests) {
          process.stdout.write(`  ${o.file}:${o.line} → ${o.acId}\n`);
        }
      }
      return 0;
    }

    process.stdout.write(paint(pc.bold, 'SpecGate status\n'));
    process.stdout.write('\n');
    if (filteredReqs.length === 0) {
      process.stdout.write(paint(pc.gray, '  No matching requirements.\n'));
    }
    for (const req of filteredReqs) {
      const title = `${req.reqId} ${req.title}${req.deprecated ? ' (deprecated)' : ''}`;
      process.stdout.write(paint(pc.bold, title) + '\n');
      for (const ac of req.acs) {
        const badge = color ? COL[ac.status](BADGE[ac.status]) : BADGE[ac.status];
        const label = color ? COL[ac.status](ac.status.padEnd(8)) : ac.status.padEnd(8);
        const tests = ac.tests.length;
        const tasks = ac.tasks.length;
        process.stdout.write(`  ${badge} ${label} ${ac.acId}  tests:${tests} tasks:${tasks}\n`);
      }
      process.stdout.write('\n');
    }

    if (matrix.orphanTests.length > 0 && wantAll) {
      process.stdout.write(paint(pc.bold, 'Orphan tests\n'));
      for (const o of matrix.orphanTests) {
        process.stdout.write(`  ${o.file}:${o.line} → ${o.acId}\n`);
      }
      process.stdout.write('\n');
    }

    const s = matrix.summary;
    process.stdout.write(
      `Summary: ${paint(pc.green, s.done + ' done')} · ${paint(pc.yellow, s.passing + ' passing')} · ${paint(pc.red, s.failing + ' failing')} · ${paint(pc.gray, s.untested + ' untested')} (total ${s.total})\n`,
    );
    return s.failing > 0 ? 1 : 0;
  } catch (err) {
    process.stderr.write(`specgate status: ${(err as Error).message}\n`);
    return 2;
  }
}
