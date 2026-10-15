import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { PRODUCT_NAME, CLI_BINARY } from '@specgate/core';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import {
  specApproveCommand,
  specListCommand,
  specNewCommand,
  specPlanCommand,
  specTasksCommand,
  specValidateCommand,
} from './commands/spec.js';

/**
 * SpecGate CLI entry point.
 * M0.D wires `--version` and `--help`; M1.F adds `init`; real subcommands
 * land in later milestones.
 */

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // In dev the script runs from src/; in build output it runs from dist/.
  // Package.json is one level up in both cases.
  const pkgPath = resolve(here, '..', 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const parsed = JSON.parse(raw) as { version: string };
  return parsed.version;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name(CLI_BINARY)
    .description(`${PRODUCT_NAME} — spec before code, rules while coding, gates before merge.`)
    .version(readVersion(), '-v, --version', 'print version and exit')
    .option('--json', 'emit machine-readable JSON (where supported)')
    .option('--quiet', 'suppress non-essential output')
    .option('--cwd <path>', 'run as if invoked from <path>')
    .option('--strictness <level>', 'override strictness: advisory | standard | strict');

  program
    .command('init')
    .description('Detect stack, write config, inject AGENTS.md managed block.')
    .option('-y, --yes', 'accept defaults, no prompts', false)
    .action(async (cmdOpts: { yes?: boolean }) => {
      const globalOpts = program.opts<{ json?: boolean; cwd?: string }>();
      const code = await initCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        yes: cmdOpts.yes ?? false,
        json: globalOpts.json ?? false,
      });
      process.exit(code);
    });

  program
    .command('doctor')
    .description('Probe host for required/optional tools; report present/missing with hints.')
    .option('--install', 'download pinned, checksum-verified tools (deferred to M8).', false)
    .action(async (cmdOpts: { install?: boolean }) => {
      const globalOpts = program.opts<{ json?: boolean; cwd?: string }>();
      const code = await doctorCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        install: cmdOpts.install ?? false,
        json: globalOpts.json ?? false,
      });
      process.exit(code);
    });

  const spec = program
    .command('spec')
    .description('Spec engine: new, validate, approve, plan, tasks, list.');

  spec
    .command('new [name]')
    .description('Interview wizard → draft requirements.md.')
    .action(async (name: string | undefined) => {
      const globalOpts = program.opts<{ json?: boolean; cwd?: string }>();
      const code = await specNewCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        json: globalOpts.json ?? false,
        ...(name ? { name } : {}),
      });
      process.exit(code);
    });

  spec
    .command('validate <specId>')
    .description('Validate a spec: structure, IDs, AC testability, immutability after approve.')
    .action(async (specId: string) => {
      const globalOpts = program.opts<{ json?: boolean; cwd?: string }>();
      const code = await specValidateCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        json: globalOpts.json ?? false,
        specId,
      });
      process.exit(code);
    });

  spec
    .command('approve <specId>')
    .description('Flip status to approved and freeze IDs (writes ids.lock.json).')
    .action(async (specId: string) => {
      const globalOpts = program.opts<{ json?: boolean; cwd?: string }>();
      const code = await specApproveCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        json: globalOpts.json ?? false,
        specId,
      });
      process.exit(code);
    });

  spec
    .command('plan <specId>')
    .description('Create/validate design.md for an approved spec.')
    .action(async (specId: string) => {
      const globalOpts = program.opts<{ json?: boolean; cwd?: string }>();
      const code = await specPlanCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        json: globalOpts.json ?? false,
        specId,
      });
      process.exit(code);
    });

  spec
    .command('tasks <specId>')
    .description('Generate/validate tasks.md; reject orphan `implements:` links.')
    .action(async (specId: string) => {
      const globalOpts = program.opts<{ json?: boolean; cwd?: string }>();
      const code = await specTasksCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        json: globalOpts.json ?? false,
        specId,
      });
      process.exit(code);
    });

  spec
    .command('list')
    .description('List all specs with status + title.')
    .action(() => {
      const globalOpts = program.opts<{ json?: boolean; cwd?: string }>();
      const code = specListCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        json: globalOpts.json ?? false,
      });
      process.exit(code);
    });

  return program;
}

export function main(argv: readonly string[] = process.argv): void {
  const program = buildProgram();
  program.parse(argv as string[]);
}

main();
