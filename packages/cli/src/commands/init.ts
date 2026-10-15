import { intro, outro, log, isCancel, cancel, confirm } from '@clack/prompts';
import { runInit, type InitAction } from '@specgate/core';

/**
 * `specgate init` — adapter for the `runInit` core function.
 * All business logic lives in core (run.md §22.3).
 */

export interface InitCommandOptions {
  readonly cwd: string;
  readonly yes?: boolean;
  readonly json?: boolean;
}

export async function initCommand(options: InitCommandOptions): Promise<number> {
  if (options.json) {
    const result = await runInit({ cwd: options.cwd });
    const payload = {
      cwd: result.cwd,
      stack: result.stack,
      strictness: result.config.strictness,
      actions: result.actions,
      nextSteps: result.nextSteps,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

  intro('SpecGate init');

  if (!options.yes) {
    const ok = await confirm({
      message: `Set up SpecGate in ${options.cwd}?`,
      initialValue: true,
    });
    if (isCancel(ok) || !ok) {
      cancel('Aborted.');
      return 1;
    }
  }

  const result = await runInit({ cwd: options.cwd });

  log.info(
    `Detected stack: ${result.stack.languages.values.join(', ') || '(none)'}` +
      (result.stack.frameworks.values.length
        ? ` / ${result.stack.frameworks.values.join(', ')}`
        : ''),
  );

  for (const a of result.actions) {
    const line = `${label(a)}  ${a.target}${a.note ? `  — ${a.note}` : ''}`;
    log.step(line);
  }

  log.message('');
  log.info('Next steps:');
  for (const step of result.nextSteps) {
    log.step(step);
  }

  outro(`strictness: ${result.config.strictness}`);
  return 0;
}

function label(a: InitAction): string {
  switch (a.action) {
    case 'created':
      return '[created] ';
    case 'replaced':
      return '[replaced]';
    case 'appended':
      return '[appended]';
    case 'unchanged':
      return '[ok]      ';
    case 'skipped':
      return '[skipped] ';
  }
}
