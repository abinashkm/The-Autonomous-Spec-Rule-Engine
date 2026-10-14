import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { PRODUCT_NAME, CLI_BINARY } from '@specgate/core';

/**
 * SpecGate CLI entry point.
 * M0.D wires `--version` and `--help`; real subcommands land in M1+.
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
  return program;
}

export function main(argv: readonly string[] = process.argv): void {
  const program = buildProgram();
  program.parse(argv as string[]);
}

main();
