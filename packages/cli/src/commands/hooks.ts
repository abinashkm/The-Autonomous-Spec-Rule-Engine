import { log, intro, outro } from '@clack/prompts';
import { installHooks, writeClaudeCodeHooks } from '@specgate/core';

/**
 * `specgate hooks <install|claude-code>` — thin adapters over core.
 */

export interface HooksCommandOptions {
  readonly cwd: string;
  readonly json?: boolean;
}

export async function hooksInstallCommand(options: HooksCommandOptions): Promise<number> {
  try {
    const r = await installHooks({ cwd: options.cwd });
    if (options.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return 0;
    }
    intro('SpecGate hooks install');
    log.step(`detected manager: ${r.manager}`);
    for (const a of r.actions) {
      log.step(`[${a.action}] ${a.target}${a.note ? ` — ${a.note}` : ''}`);
    }
    outro('Done.');
    return 0;
  } catch (err) {
    process.stderr.write(`specgate hooks install: ${(err as Error).message}\n`);
    return 2;
  }
}

export function hooksClaudeCodeCommand(options: HooksCommandOptions): number {
  try {
    const r = writeClaudeCodeHooks(options.cwd);
    if (options.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return 0;
    }
    log.success(`[${r.action}] ${r.path}`);
    return 0;
  } catch (err) {
    process.stderr.write(`specgate hooks claude-code: ${(err as Error).message}\n`);
    return 2;
  }
}
