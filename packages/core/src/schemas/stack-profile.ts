import { z } from 'zod';

/**
 * StackProfile — output of the stack detector (M1.B).
 * Source of truth: run.md §5.1.
 */

const Confidence = z.number().min(0).max(1);

const DetectedField = z.object({
  values: z.array(z.string().min(1)).default([]),
  confidence: Confidence.default(0),
});
export type DetectedField = z.infer<typeof DetectedField>;

export const StackProfile = z
  .object({
    languages: DetectedField,
    frameworks: DetectedField,
    packageManagers: DetectedField,
    testRunners: DetectedField,
    linters: DetectedField,
    architectureHints: DetectedField,
    ciProvider: z
      .object({
        value: z.string().min(1).nullable().default(null),
        confidence: Confidence.default(0),
      })
      .default({ value: null, confidence: 0 }),
    rootPath: z.string().min(1),
    detectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T/, {
      message: 'detectedAt must be an ISO timestamp',
    }),
  })
  .strict();
export type StackProfile = z.infer<typeof StackProfile>;

export const EMPTY_DETECTED_FIELD: DetectedField = { values: [], confidence: 0 };

/** Factory for an empty profile with a given root. */
export function emptyStackProfile(rootPath: string, detectedAt = new Date().toISOString()): StackProfile {
  return {
    languages: { ...EMPTY_DETECTED_FIELD },
    frameworks: { ...EMPTY_DETECTED_FIELD },
    packageManagers: { ...EMPTY_DETECTED_FIELD },
    testRunners: { ...EMPTY_DETECTED_FIELD },
    linters: { ...EMPTY_DETECTED_FIELD },
    architectureHints: { ...EMPTY_DETECTED_FIELD },
    ciProvider: { value: null, confidence: 0 },
    rootPath,
    detectedAt,
  };
}
