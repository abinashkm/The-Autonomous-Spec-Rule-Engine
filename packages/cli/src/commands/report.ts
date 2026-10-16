import { writeFileSync } from 'node:fs';
import {
  renderJsonReport,
  renderMarkdownReport,
  renderSarifReport,
  renderTerminalReport,
  runCheck,
} from '@specgate/core';

/**
 * `specgate report --format <sarif|md|json|terminal>` — runs a check and
 * emits the result in the chosen format. Primarily used by the GitHub Action
 * (M4.C) to produce the SARIF file + PR comment body.
 */

export type ReportFormat = 'sarif' | 'md' | 'json' | 'terminal';

export interface ReportCommandOptions {
  readonly cwd: string;
  readonly format: ReportFormat;
  readonly output?: string;
  readonly toolVersion?: string;
}

export async function reportCommand(options: ReportCommandOptions): Promise<number> {
  try {
    const run = await runCheck({ cwd: options.cwd, scope: 'full' });
    let body: string;
    switch (options.format) {
      case 'sarif':
        body = renderSarifReport(run.results, {
          repoRoot: options.cwd,
          ...(options.toolVersion ? { toolVersion: options.toolVersion } : {}),
        });
        break;
      case 'md':
        body = renderMarkdownReport(run.results);
        break;
      case 'json':
        body = renderJsonReport(run.results);
        break;
      case 'terminal':
        body = renderTerminalReport(run.results, { color: process.stdout.isTTY });
        break;
    }
    if (options.output) {
      writeFileSync(options.output, body, 'utf8');
    } else {
      process.stdout.write(body);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`specgate report: ${(err as Error).message}\n`);
    return 2;
  }
}
