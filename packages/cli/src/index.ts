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
import { checkCommand } from './commands/check.js';
import { reportCommand, type ReportFormat } from './commands/report.js';
import { hooksClaudeCodeCommand, hooksInstallCommand } from './commands/hooks.js';
import { commitMsgCommand } from './commands/commit-msg.js';
import { mcpCommand } from './commands/mcp.js';
import { statusCommand } from './commands/status.js';

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

  program
    .command('check')
    .description('Run gates (secrets, lint, tests) and report findings.')
    .option('--staged', 'scope to staged files (pre-commit path)', false)
    .option('--changed', 'scope to changed vs HEAD', false)
    .option(
      '--gate <id>',
      'repeatable: limit to one gate',
      (val, prev: string[] = []) => prev.concat([val]),
      [] as string[],
    )
    .option('--fail-on-warn', 'exit 3 when any warn-only findings are present', false)
    .option('--fix-prompt', 'print the fix prompt (full implementation lands in M5)', false)
    .action(
      async (cmdOpts: {
        staged?: boolean;
        changed?: boolean;
        gate?: string[];
        failOnWarn?: boolean;
        fixPrompt?: boolean;
      }) => {
        const globalOpts = program.opts<{
          json?: boolean;
          cwd?: string;
          strictness?: 'advisory' | 'standard' | 'strict';
        }>();
        const scope: 'staged' | 'changed' | 'full' = cmdOpts.staged
          ? 'staged'
          : cmdOpts.changed
            ? 'changed'
            : 'full';
        const code = await checkCommand({
          cwd: resolve(globalOpts.cwd ?? process.cwd()),
          scope,
          gates: cmdOpts.gate ?? [],
          json: globalOpts.json ?? false,
          failOnWarn: cmdOpts.failOnWarn ?? false,
          fixPrompt: cmdOpts.fixPrompt ?? false,
          ...(globalOpts.strictness ? { strictness: globalOpts.strictness } : {}),
        });
        process.exit(code);
      },
    );

  program
    .command('report')
    .description('Render the last check in a chosen format (sarif, md, json, terminal).')
    .requiredOption('--format <fmt>', 'sarif | md | json | terminal', 'terminal')
    .option('--output <file>', 'write to file instead of stdout')
    .action(async (cmdOpts: { format: ReportFormat; output?: string }) => {
      const globalOpts = program.opts<{ cwd?: string }>();
      const code = await reportCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        format: cmdOpts.format,
        ...(cmdOpts.output ? { output: cmdOpts.output } : {}),
        toolVersion: readVersion(),
      });
      process.exit(code);
    });

  const hooks = program.command('hooks').description('Install / manage SpecGate hooks.');

  hooks
    .command('install')
    .description('Install git-hook integration (detect husky/pre-commit/lefthook; else own shims).')
    .action(async () => {
      const globalOpts = program.opts<{ cwd?: string; json?: boolean }>();
      const code = await hooksInstallCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        json: globalOpts.json ?? false,
      });
      process.exit(code);
    });

  hooks
    .command('claude-code')
    .description('Write / merge .claude/settings.json with the SpecGate hook spec.')
    .action(() => {
      const globalOpts = program.opts<{ cwd?: string; json?: boolean }>();
      const code = hooksClaudeCodeCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        json: globalOpts.json ?? false,
      });
      process.exit(code);
    });

  // Hidden hook helper — invoked by the commit-msg shim; not advertised.
  program
    .command('_commit-msg <msgPath>', { hidden: true })
    .description('Validate the trailer in <msgPath>. Internal; invoked by the commit-msg shim.')
    .action((msgPath: string) => {
      const globalOpts = program.opts<{ cwd?: string }>();
      const code = commitMsgCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        msgPath,
      });
      process.exit(code);
    });

  program
    .command('mcp')
    .description('Start the SpecGate MCP server over stdio (run.md §9.2).')
    .action(async () => {
      const globalOpts = program.opts<{ cwd?: string }>();
      const code = await mcpCommand({
        cwd: resolve(globalOpts.cwd ?? process.cwd()),
        version: readVersion(),
      });
      process.exit(code);
    });

  program
    .command('status')
    .description('Traceability matrix: requirement → tasks → tests → status.')
    .option('--untested-only', 'show only ACs with status untested', false)
    .option('--failing-only', 'show only ACs with status failing', false)
    .option('--orphans', 'show the orphan-test list only', false)
    .action(
      async (cmdOpts: { untestedOnly?: boolean; failingOnly?: boolean; orphans?: boolean }) => {
        const globalOpts = program.opts<{ cwd?: string; json?: boolean }>();
        const code = await statusCommand({
          cwd: resolve(globalOpts.cwd ?? process.cwd()),
          json: globalOpts.json ?? false,
          untestedOnly: cmdOpts.untestedOnly ?? false,
          failingOnly: cmdOpts.failingOnly ?? false,
          orphans: cmdOpts.orphans ?? false,
        });
        process.exit(code);
      },
    );

  return program;
}

export function main(argv: readonly string[] = process.argv): void {
  const program = buildProgram();
  program.parse(argv as string[]);
}

main();
