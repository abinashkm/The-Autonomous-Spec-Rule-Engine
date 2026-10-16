import { describe, expect, it } from 'vitest';
import { resolveBinary, run, ResolveBinaryError } from '../../src/subprocess/run.js';
import { redact, redactLiteral } from '../../src/subprocess/redact.js';

describe('resolveBinary', () => {
  it('resolves a known binary (node)', () => {
    const abs = resolveBinary('node');
    expect(abs.length).toBeGreaterThan(0);
    expect(abs).toMatch(/node(\.exe)?$/i);
  });

  it('throws ResolveBinaryError for a non-existent binary', () => {
    expect(() => resolveBinary('definitely-not-a-real-binary-xyz')).toThrow(ResolveBinaryError);
  });
});

describe('run', () => {
  it('captures stdout from `node -e`', async () => {
    const result = await run('node', ['-e', 'process.stdout.write("hello")']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.timedOut).toBe(false);
  });

  it('returns non-zero exit without throwing', async () => {
    const result = await run('node', ['-e', 'process.exit(7)']);
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it('caps buffer size (DoD: 1 MB default)', async () => {
    // Emit ~1.5 MB; retained stdout should be ≤ 1 MB.
    const result = await run('node', ['-e', 'process.stdout.write("x".repeat(1500000))']);
    expect(result.stdout.length).toBeLessThanOrEqual(1024 * 1024);
  });

  it('honours timeout', async () => {
    const result = await run('node', ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
  });

  it('allows argument arrays to carry shell-metacharacter strings safely', async () => {
    // The input `; echo PWNED` would run a second command in a shell string; as
    // an argv array it stays a single argv entry and is just echoed back.
    const payload = '; echo PWNED && exit 0';
    const result = await run('node', [
      '-e',
      'process.stdout.write(process.argv[1] ?? "")',
      payload,
    ]);
    expect(result.stdout).toBe(payload);
    expect(result.exitCode).toBe(0);
  });
});

describe('redact', () => {
  it('masks OpenAI-style api keys', () => {
    const out = redact('key is sk-abcdef1234567890 in config');
    expect(out).not.toContain('sk-abcdef1234567890');
    expect(out).toContain('***REDACTED***');
  });

  it('masks AWS access keys', () => {
    const out = redact('AKIAABCDEFGHIJKLMNOP leaked');
    expect(out).not.toContain('AKIAABCDEFGHIJKLMNOP');
  });

  it('masks private-key blocks', () => {
    const key = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'xxxxxxx',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const out = redact(key);
    expect(out).toBe('***REDACTED***');
  });

  it('redactLiteral replaces a known secret verbatim', () => {
    const s = 'secret=hunter2;';
    expect(redactLiteral(s, 'hunter2')).toBe('secret=***REDACTED***;');
  });

  it('redactLiteral is a no-op for very short literals', () => {
    expect(redactLiteral('abcd', 'ab')).toBe('abcd');
  });
});
