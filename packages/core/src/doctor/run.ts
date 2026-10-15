import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { detectStackCached } from '../stack/cache.js';
import type { StackProfile } from '../schemas/stack-profile.js';

/**
 * `specgate doctor` business logic.
 * Source of truth: run.md §8 CLI, §24.3 "removing the missing-tools problem".
 *
 * Probes the host for the tools SpecGate needs to run gates. Reports present /
 * missing with an install hint. In M1 we only PROBE; `--install` lands in M8
 * (ADR-015).
 *
 * Important: subprocess safety per §22.7 — argument arrays, no shell.
 */

export type ToolStatus = 'present' | 'missing';

export interface ToolProbeResult {
  readonly tool: string;
  readonly status: ToolStatus;
  readonly version: string | null;
  readonly path: string | null;
  readonly hint: string;
  readonly required: boolean;
}

export interface DoctorResult {
  readonly cwd: string;
  readonly stack: StackProfile;
  readonly probes: readonly ToolProbeResult[];
  readonly ok: boolean;
}

interface ToolSpec {
  readonly tool: string;
  readonly command: string;
  readonly versionArgs: readonly string[];
  readonly hint: string;
  /** Only probe when this predicate on the detected stack returns true. */
  readonly relevant?: (stack: StackProfile) => boolean;
}

const CORE_TOOLS: readonly ToolSpec[] = [
  {
    tool: 'node',
    command: 'node',
    versionArgs: ['--version'],
    hint: 'Node ≥ 20 is required to run SpecGate. See https://nodejs.org/.',
  },
  {
    tool: 'git',
    command: 'git',
    versionArgs: ['--version'],
    hint: 'Git is required for the git-hook installer and traceability trailers.',
  },
  {
    tool: 'gitleaks',
    command: 'gitleaks',
    versionArgs: ['version'],
    hint: 'Secrets gate uses gitleaks. Run `specgate doctor --install` (deferred to M8) or install manually.',
  },
];

const LANG_TOOLS: readonly ToolSpec[] = [
  {
    tool: 'pnpm',
    command: 'pnpm',
    versionArgs: ['--version'],
    hint: 'pnpm detected as the project package manager.',
    relevant: (s) => s.packageManagers.values.includes('pnpm'),
  },
  {
    tool: 'npm',
    command: 'npm',
    versionArgs: ['--version'],
    hint: 'npm detected as the project package manager.',
    relevant: (s) =>
      s.packageManagers.values.includes('npm') && !s.packageManagers.values.includes('pnpm'),
  },
  {
    tool: 'python',
    command: 'python',
    versionArgs: ['--version'],
    hint: 'Python detected in this repo; the test gate will shell out to pytest.',
    relevant: (s) => s.languages.values.includes('python'),
  },
  {
    tool: 'ruff',
    command: 'ruff',
    versionArgs: ['--version'],
    hint: 'ruff is the linter configured for this repo. Install: `pip install ruff` or `uvx ruff`.',
    relevant: (s) => s.linters.values.includes('ruff'),
  },
];

export interface DoctorOptions {
  readonly cwd: string;
}

function probeTool(spec: ToolSpec): ToolProbeResult {
  // Safety: argument arrays, no shell interpolation (run.md §22.7).
  try {
    const out = execFileSync(spec.command, spec.versionArgs as string[], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    const version = out.trim().split('\n')[0]?.trim() ?? null;
    return {
      tool: spec.tool,
      status: 'present',
      version,
      path: null,
      hint: spec.hint,
      required: !spec.relevant,
    };
  } catch {
    return {
      tool: spec.tool,
      status: 'missing',
      version: null,
      path: null,
      hint: spec.hint,
      required: !spec.relevant,
    };
  }
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const cwd = resolve(options.cwd);
  const stack = await detectStackCached(cwd, { useCache: true });

  const probes: ToolProbeResult[] = [];
  for (const spec of CORE_TOOLS) {
    probes.push(probeTool(spec));
  }
  for (const spec of LANG_TOOLS) {
    if (!spec.relevant || spec.relevant(stack)) {
      probes.push(probeTool(spec));
    }
  }

  // "ok" means: every required tool is present. Optional (language-specific)
  // tools can be missing without flipping ok to false — doctor is advisory
  // in M1; the gate runner (M3) will mark gates `skipped` when a tool is gone.
  const ok = probes.filter((p) => p.required).every((p) => p.status === 'present');

  return { cwd, stack, probes, ok };
}
