import { describe, expect, it } from 'vitest';
import { StackProfile, emptyStackProfile } from '../../src/schemas/stack-profile.js';

describe('StackProfile', () => {
  it('accepts an empty profile from the factory', () => {
    const profile = emptyStackProfile('/tmp/foo');
    expect(() => StackProfile.parse(profile)).not.toThrow();
  });

  it('rejects confidence outside [0, 1]', () => {
    const profile = emptyStackProfile('/tmp/foo');
    (profile.languages as { confidence: number }).confidence = 1.5;
    const r = StackProfile.safeParse(profile);
    expect(r.success).toBe(false);
  });

  it('rejects a non-ISO detectedAt', () => {
    const profile = emptyStackProfile('/tmp/foo');
    (profile as { detectedAt: string }).detectedAt = 'yesterday';
    const r = StackProfile.safeParse(profile);
    expect(r.success).toBe(false);
  });
});
