/**
 * SpecGate product-level constants.
 *
 * `PRODUCT_NAME` lives in exactly one place so that a rename (see run.md §21.2
 * row 1: Name availability) costs under an hour.
 */

export const PRODUCT_NAME = 'SpecGate';
export const CLI_BINARY = 'specgate';
export const CLI_ALIAS = 'sg';

/** Markdown markers for the managed-block writer (run.md §6, §22.8). */
export const MANAGED_BLOCK_BEGIN = '<!-- specgate:begin -->';
export const MANAGED_BLOCK_END = '<!-- specgate:end -->';
