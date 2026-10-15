import { intro, outro, log } from '@clack/prompts';
import { runDoctor } from '@specgate/core';

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
}

export async function doctorCommand(options: DoctorCommandOptions): Promise<number> {
  if (options.install) {
    const msg =
      'specgate doctor --install is deferred to M8 (ADR-015). ' +
      'Install tools manually for now (see the hints printed by `specgate doctor`).';
    if (options.json) {
      process.stdout.write(JSON.stringify({ status: 'deferred', message: msg }) + '\n');
    } else {
      process.stderr.write(msg + '\n');
    }
    return 2;
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
