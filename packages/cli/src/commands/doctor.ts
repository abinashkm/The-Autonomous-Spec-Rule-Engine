import { confirm, intro, isCancel, log, outro } from '@clack/prompts';
import { installPinnedTools, runDoctor } from '@specgate/core';

/**
 * `specgate doctor` — adapter for the `runDoctor` core function.
 * Business logic lives in core (run.md §22.3).
 *
 * `--install` is intentionally stubbed in M1 and lands in M8 per ADR-015.
 */

export interface DoctorCommandOptions {
  readonly cwd: string;
  readonly install?: boolean;
  readonly json?: boolean;
  readonly yes?: boolean;
}

export async function doctorCommand(options: DoctorCommandOptions): Promise<number> {
  if (options.install) {
    // Explicit human consent (ADR-015). Non-interactive JSON callers must pass
    // --yes or the install reports every tool as "skipped (consent: false)".
    let consent = options.yes ?? false;
    if (!consent && !options.json) {
      intro('SpecGate doctor --install');
      const ok = await confirm({
        message:
          'Download and install pinned, checksum-verified tool binaries into ~/.specgate/bin? (ADR-015)',
        initialValue: true,
      });
      if (isCancel(ok) || !ok) {
        log.warn('Aborted.');
        return 1;
      }
      consent = true;
    }
    const result = await installPinnedTools({ consent });
    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      for (const a of result.actions) {
        const line = `[${a.action}] ${a.tool}@${a.version} ${a.platform} → ${a.target}${a.note ? ` — ${a.note}` : ''}`;
        if (a.action === 'installed') log.success(line);
        else if (a.action === 'error') log.error(line);
        else log.step(line);
      }
      outro(`bin dir: ${result.binDir}`);
    }
    const hadError = result.actions.some((a) => a.action === 'error');
    return hadError ? 2 : 0;
  }

  const result = await runDoctor({ cwd: options.cwd });

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 0; // doctor is advisory in M1; missing optional tools do not fail CI
  }

  intro('SpecGate doctor');
  for (const p of result.probes) {
    const prefix = p.status === 'present' ? '[ok]     ' : '[missing]';
    const version = p.version ? `  (${p.version})` : '';
    const line = `${prefix} ${p.tool}${version}`;
    if (p.status === 'present') log.step(line);
    else log.warn(`${line} — ${p.hint}`);
  }
  outro(result.ok ? 'All required tools present.' : 'Some required tools are missing (see above).');
  return 0;
}
