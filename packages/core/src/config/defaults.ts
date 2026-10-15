import { ConfigSchema, type Config } from '../schemas/config.js';

/**
 * Default config. Everything the schema requires + the §7.2 defaults.
 * Used as the base layer for `resolveConfig` (M1.E.3).
 */

export function defaultConfig(): Config {
  return ConfigSchema.parse({
    version: 1,
    strictness: 'standard',
    stack: { override: {} },
    packs: [],
    gates: {
      secrets: { enabled: true, tool: 'gitleaks', blocking_at: 'standard' },
      lint: { enabled: true, command: 'auto', blocking_at: 'standard' },
      tests: { enabled: true, command: 'auto', blocking_at: 'standard' },
      coverage: { enabled: true, changed_files_min: 70, blocking_at: 'strict' },
      architecture: { enabled: true, blocking_at: 'strict' },
      dependencies: { enabled: true, tool: 'osv-scanner', blocking_at: 'strict' },
      spec: { enabled: true, require_spec_for_changes: true, blocking_at: 'strict' },
    },
    fix_loop: { max_attempts: 3 },
    context: { max_rule_tokens: 4000 },
    telemetry: 'off',
  });
}
