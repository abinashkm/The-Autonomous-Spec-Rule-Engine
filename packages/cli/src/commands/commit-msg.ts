import { readFileSync } from 'node:fs';
import { resolveConfig, validateCommitMessage } from '@specgate/core';

/**
 * Hidden `specgate _commit-msg <path>` command used by the commit-msg shim.
 * Returns exit 0 on pass/warn, exit 1 on block (strictness >= standard).
 */
export function commitMsgCommand(options: {
  readonly cwd: string;
  readonly msgPath: string;
}): number {
  const config = resolveConfig({ cwd: options.cwd });
  const message = readFileSync(options.msgPath, 'utf8');
  const verdict = validateCommitMessage({ cwd: options.cwd, message, config });
  if (verdict.ok) return 0;
  if (verdict.severity === 'block') {
    process.stderr.write(`SpecGate: ${verdict.message}\n`);
    return 1;
  }
  process.stderr.write(`SpecGate (warn): ${verdict.message}\n`);
  return 0;
}
