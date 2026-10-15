/**
 * Managed-block markers.
 * Source of truth: run.md §6 "generated blocks in shared files are wrapped in markers".
 *
 * Re-exports from constants.ts so the actual strings live in exactly one place
 * (§21.2 row 1 — rename cost < 1h).
 */
export { MANAGED_BLOCK_BEGIN as BEGIN, MANAGED_BLOCK_END as END } from '../constants.js';
