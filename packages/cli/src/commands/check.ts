import {
  buildCorrectionPrompt,
  exitCodeFor,
  readState,
  renderJsonReport,
  renderTerminalReport,
  resetState,
  runCheck,
  shouldStop,
  writeState,
  type RunCheckOptions,
} from '@specgate/core';

/**
 * `specgate check` CLI adapter.
 *
 * Flags:
 *   --staged       scope → staged (pre-commit path)
 *   --changed      scope → changed vs HEAD
 *   --gate <id>    repeatable gate filter
 *   --json         emit stable JSON instead of terminal report
 *   --fail-on-warn exit 3 when warnings present
 *   --fix-prompt   emit the correction prompt (M5.B) on blocking failures and
 *                  advance / reset the fix-loop state in .specgate/state.json
 *
 * Exit codes (run.md §8): 0 pass, 1 blocking fail, 2 tool/config error, 3 warn-only + --fail-on-warn.
 */

export interface CheckCommandOptions {
  readonly cwd: string;
  readonly scope?: 'staged' | 'changed' | 'full';
  readonly gates?: readonly string[];
  readonly json?: boolean;
  readonly failOnWarn?: boolean;
  readonly fixPrompt?: boolean;
  readonly strictness?: 'advisory' | 'standard' | 'strict';
}

export async function checkCommand(options: CheckCommandOptions): Promise<number> {
  const runOpts: RunCheckOptions = {
    cwd: options.cwd,
    scope: options.scope ?? 'full',
    ...(options.gates && options.gates.length > 0 ? { gates: options.gates } : {}),
    ...(options.strictness ? { strictnessOverride: options.strictness } : {}),
  };

  try {
    const result = await runCheck(runOpts);

    if (options.json) {
      process.stdout.write(renderJsonReport(result.results));
    } else {
      process.stdout.write(renderTerminalReport(result.results, { color: process.stdout.isTTY }));
    }

    if (options.fixPrompt) {
      const state = readState(options.cwd);
      const maxAttempts = result.config.fix_loop.max_attempts;
      const verdict = shouldStop({ state, maxAttempts, results: result.results });

      if (verdict.reason === 'success') {
        resetState(options.cwd);
      } else {
        writeState(options.cwd, verdict.nextState);
        const prompt = buildCorrectionPrompt(result.results, {
          attempt: verdict.nextState.attempt,
          maxAttempts,
        });
        process.stdout.write('\n----- fix prompt -----\n');
        process.stdout.write(prompt.text + '\n');
        if (verdict.stop && verdict.reason) {
          process.stdout.write(`\n[stop reason: ${verdict.reason}]\n`);
        }
      }
    }

    return exitCodeFor({
      summary: result.summary,
      results: result.results,
      ...(options.failOnWarn ? { failOnWarn: true } : {}),
    });
  } catch (err) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ error: (err as Error).message }) + '\n');
    } else {
      process.stderr.write(`specgate check: ${(err as Error).message}\n`);
    }
    return 2;
  }
}
