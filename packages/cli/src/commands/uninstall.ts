import { confirm, intro, isCancel, log, outro } from '@clack/prompts';
import { runUninstall } from '@specgate/core';

/**
 * `specgate uninstall` — undo everything `init` created.
 */

export interface UninstallCommandOptions {
  readonly cwd: string;
  readonly yes?: boolean;
  readonly purge?: boolean;
  readonly json?: boolean;
}

export async function uninstallCommand(options: UninstallCommandOptions): Promise<number> {
  if (!options.json && !options.yes) {
    intro('SpecGate uninstall');
    const ok = await confirm({
      message: options.purge
        ? `Delete the entire .specgate/ directory in ${options.cwd}?`
        : `Remove SpecGate hooks + managed blocks in ${options.cwd}?`,
      initialValue: true,
    });
    if (isCancel(ok) || !ok) {
      log.warn('Aborted.');
      return 1;
    }
  }

  const result = await runUninstall({ cwd: options.cwd, purge: options.purge ?? false });

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }

  for (const a of result.actions) {
    log.step(`[${a.action}] ${a.target}${a.note ? ` — ${a.note}` : ''}`);
  }
  outro('Done.');
  return 0;
}
