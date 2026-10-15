import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigLoadError,
  CONFIG_RELPATH,
  loadConfig,
  resolveConfig,
} from '../../src/config/load.js';
import { defaultConfig } from '../../src/config/defaults.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-cfg-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(body: string): void {
  mkdirSync(join(tmp, '.specgate'), { recursive: true });
  writeFileSync(join(tmp, CONFIG_RELPATH), body, 'utf8');
}

const VALID_YAML = `
version: 1
strictness: standard
stack:
  override: {}
packs: []
gates:
  secrets: { enabled: true, tool: gitleaks, blocking_at: standard }
  lint: { enabled: true, command: auto, blocking_at: standard }
  tests: { enabled: true, command: auto, blocking_at: standard }
  coverage: { enabled: true, changed_files_min: 70, blocking_at: strict }
  architecture: { enabled: true, blocking_at: strict }
  dependencies: { enabled: true, tool: osv-scanner, blocking_at: strict }
  spec: { enabled: true, require_spec_for_changes: true, blocking_at: strict }
fix_loop:
  max_attempts: 3
context:
  max_rule_tokens: 4000
telemetry: off
`;

describe('loadConfig', () => {
  it('returns null when the config file is absent', () => {
    expect(loadConfig(tmp)).toBeNull();
  });

  it('parses a valid YAML config', () => {
    writeConfig(VALID_YAML);
    const cfg = loadConfig(tmp)!;
    expect(cfg.strictness).toBe('standard');
    expect(cfg.gates.secrets.tool).toBe('gitleaks');
  });

  it('throws a readable error on bad strictness, path pointing at /strictness', () => {
    writeConfig(VALID_YAML.replace('strictness: standard', 'strictness: yolo'));
    try {
      loadConfig(tmp);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigLoadError);
      expect((err as Error).message).toContain('/strictness');
    }
  });

  it('throws on malformed YAML', () => {
    writeConfig('version: 1\nstrictness: : :\n');
    expect(() => loadConfig(tmp)).toThrow(ConfigLoadError);
  });
});

describe('resolveConfig', () => {
  it('returns defaults when no file exists', () => {
    const cfg = resolveConfig({ cwd: tmp });
    expect(cfg).toEqual(defaultConfig());
  });

  it('user config overrides defaults (strict > standard)', () => {
    writeConfig(VALID_YAML.replace('strictness: standard', 'strictness: strict'));
    const cfg = resolveConfig({ cwd: tmp });
    expect(cfg.strictness).toBe('strict');
  });

  it('CLI flag beats user config (advisory flag over strict config)', () => {
    writeConfig(VALID_YAML.replace('strictness: standard', 'strictness: strict'));
    const cfg = resolveConfig({ cwd: tmp, cliFlags: { strictness: 'advisory' } });
    expect(cfg.strictness).toBe('advisory');
  });
});
