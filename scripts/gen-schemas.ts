#!/usr/bin/env tsx
/**
 * Deterministically emit JSON Schema files for every zod schema in @specgate/core.
 *
 * Run: pnpm schemas
 *
 * Determinism matters because CI diff-fails if the on-disk JSON schemas drift
 * from the zod sources without regeneration. We get determinism from:
 *   1. zod v4's built-in `z.toJSONSchema` (no timestamps, pure function of the schema).
 *   2. Sorting every object's keys before serializing.
 *
 * Required by M0.C.7 / M0.C.8 of PLAN.md.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, type ZodType } from 'zod';

import {
  ConfigSchema,
  ParsedRequirements,
  ParsedTasks,
  PackManifest,
  GateResult,
  StackProfile,
} from '../packages/core/src/schemas/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMAS_DIR = resolve(__dirname, '..', 'schemas');

const SCHEMAS: Array<{ file: string; name: string; schema: ZodType }> = [
  {
    file: 'config.schema.json',
    name: 'SpecGateConfig',
    schema: ConfigSchema as unknown as ZodType,
  },
  {
    file: 'requirements.schema.json',
    name: 'ParsedRequirements',
    schema: ParsedRequirements as unknown as ZodType,
  },
  { file: 'tasks.schema.json', name: 'ParsedTasks', schema: ParsedTasks as unknown as ZodType },
  { file: 'pack.schema.json', name: 'PackManifest', schema: PackManifest as unknown as ZodType },
  { file: 'gate-result.schema.json', name: 'GateResult', schema: GateResult as unknown as ZodType },
  {
    file: 'stack-profile.schema.json',
    name: 'StackProfile',
    schema: StackProfile as unknown as ZodType,
  },
];

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function main(): void {
  mkdirSync(SCHEMAS_DIR, { recursive: true });

  for (const entry of SCHEMAS) {
    const jsonSchema = z.toJSONSchema(entry.schema, { target: 'draft-7' }) as Record<
      string,
      unknown
    >;
    jsonSchema.title = entry.name;
    jsonSchema.$id = `https://raw.githubusercontent.com/abinashkm/The-Autonomous-Spec-Rule-Engine/main/schemas/${entry.file}`;
    const sorted = sortKeysDeep(jsonSchema);
    const out = JSON.stringify(sorted, null, 2) + '\n';
    const outPath = join(SCHEMAS_DIR, entry.file);
    writeFileSync(outPath, out, 'utf8');
    console.log(`wrote ${entry.file}`);
  }
}

main();
