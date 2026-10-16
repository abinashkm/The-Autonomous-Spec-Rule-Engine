import type { Gate, GateId } from './types.js';

/**
 * Gate registry.
 * Source of truth: run.md §10.
 *
 * Deterministic ordering: `listGates()` returns gates sorted by id so that
 * reports and tests are stable across platforms.
 */

const REGISTRY = new Map<GateId, Gate>();

export function registerGate(gate: Gate): void {
  REGISTRY.set(gate.id, gate);
}

export function getGate(id: GateId): Gate | undefined {
  return REGISTRY.get(id);
}

export function listGates(): Gate[] {
  return [...REGISTRY.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Test-only: wipe the registry between tests. Not exported from the barrel. */
export function _clearRegistry(): void {
  REGISTRY.clear();
}
