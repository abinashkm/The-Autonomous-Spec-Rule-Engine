import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import yaml from 'js-yaml';
import { ConfigSchema, type Config, Strictness } from '../schemas/config.js';
import { defaultConfig } from './defaults.js';

/**
 * Load, parse, and validate `.specgate/config.yaml`.
 * Source of truth: run.md §7.2.
 *
 * Returns `null` when the file does not exist (callers should pick between
 * "run `init` first" and "use defaults").
 */

export const CONFIG_RELPATH = '.specgate/config.yaml';

export class ConfigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

export function loadConfig(cwd: string): Config | null {
  const abs = resolve(cwd, CONFIG_RELPATH);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new ConfigLoadError(`Failed to parse YAML in ${abs}: ${(err as Error).message}`);
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const summary = result.error.issues
      .map((i) => `  /${i.path.join('/')}: ${i.message}`)
      .join('\n');
    throw new ConfigLoadError(`Invalid ${CONFIG_RELPATH}:\n${summary}`);
  }
  return result.data;
}

/** CLI-level flag overrides that apply AFTER user config. */
export interface CliFlagOverrides {
  readonly strictness?: Config['strictness'];
}

/**
 * Resolve the final effective config.
 * Merge order (run.md §7.2 implied, M1.E.3 explicit):
 *   defaults ← preset ← user config ← CLI flags
 *
 * `preset` is intentionally still a stub — presets land in M8.
 */
export function resolveConfig(options: {
  readonly cwd: string;
  readonly cliFlags?: CliFlagOverrides;
  readonly preset?: Partial<Config>;
}): Config {
  const base = defaultConfig();
  const preset = options.preset ?? {};
  const user = loadConfig(options.cwd);
  const flags = options.cliFlags ?? {};

  const merged: Config = ConfigSchema.parse({
    ...base,
    ...preset,
    ...(user ?? {}),
    ...(flags.strictness ? { strictness: Strictness.parse(flags.strictness) } : {}),
  });
  return merged;
}

/** Default write path, for `init` and tests. */
export function configPath(cwd: string): string {
  return join(resolve(cwd), CONFIG_RELPATH);
}
