import type { Strictness } from '../schemas/config.js';

/**
 * Strictness ordering (run.md §10.3): a gate blocks iff
 * `strictness >= gate.blocking_at`.
 */
const ORDER: Record<Strictness, number> = {
  advisory: 0,
  standard: 1,
  strict: 2,
};

export function isBlocking(current: Strictness, gateBlockingAt: Strictness): boolean {
  return ORDER[current] >= ORDER[gateBlockingAt];
}
