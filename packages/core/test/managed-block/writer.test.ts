import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ManagedBlockError,
  readManagedBlock,
  removeManagedBlock,
  writeManagedBlock,
} from '../../src/managed-block/writer.js';
import { BEGIN, END } from '../../src/managed-block/markers.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-mb-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('writeManagedBlock', () => {
  it('(a) creates a new file with just the block when createIfMissing is true', () => {
    const file = join(tmp, 'AGENTS.md');
    const r = writeManagedBlock(file, 'hello\nworld', { createIfMissing: true });
    expect(r.action).toBe('created');
    const text = readFileSync(file, 'utf8');
    expect(text).toBe(`${BEGIN}\nhello\nworld\n${END}\n`);
  });

  it('(b) replaces content between markers, preserving outside bytes', () => {
    const file = join(tmp, 'AGENTS.md');
    const outside_before = '# User header\n\n## notes about my project\n\n';
    const outside_after = '\n\n## more user content\nkeep me!\n';
    const existing = outside_before + `${BEGIN}\nold managed\n${END}` + outside_after;
    writeFileSync(file, existing, 'utf8');

    const r = writeManagedBlock(file, 'brand new\ncontent');
    expect(r.action).toBe('replaced');

    const text = readFileSync(file, 'utf8');
    expect(text).toBe(outside_before + `${BEGIN}\nbrand new\ncontent\n${END}` + outside_after);
  });

  it('(c) errors when markers absent and createIfMissing is false', () => {
    const file = join(tmp, 'README.md');
    writeFileSync(file, '# A file with no markers', 'utf8');
    expect(() => writeManagedBlock(file, 'x')).toThrow(ManagedBlockError);
  });

  it('(d) appends the block when markers are absent and createIfMissing is true', () => {
    const file = join(tmp, 'README.md');
    writeFileSync(file, '# existing content\n', 'utf8');
    const r = writeManagedBlock(file, 'managed body', { createIfMissing: true });
    expect(r.action).toBe('appended');
    const text = readFileSync(file, 'utf8');
    expect(text).toBe(`# existing content\n\n${BEGIN}\nmanaged body\n${END}\n`);
  });

  it('is idempotent across repeated calls (DoD)', () => {
    const file = join(tmp, 'AGENTS.md');
    writeManagedBlock(file, 'same body', { createIfMissing: true });
    const first = readFileSync(file, 'utf8');
    const r = writeManagedBlock(file, 'same body');
    expect(r.action).toBe('unchanged');
    const second = readFileSync(file, 'utf8');
    expect(second).toBe(first);
  });

  it('throws on a half-marker file (only begin OR only end present)', () => {
    const file = join(tmp, 'AGENTS.md');
    writeFileSync(file, `before\n${BEGIN}\norphan\n`, 'utf8');
    expect(() => writeManagedBlock(file, 'x', { createIfMissing: true })).toThrow(/one of the two/);
  });

  it('preserves CRLF line endings in existing files', () => {
    const file = join(tmp, 'AGENTS.md');
    const existing = `# h\r\n\r\n${BEGIN}\r\nold\r\n${END}\r\n\r\nmore\r\n`;
    writeFileSync(file, existing, 'utf8');
    writeManagedBlock(file, 'new');
    const text = readFileSync(file, 'utf8');
    expect(text).toBe(`# h\r\n\r\n${BEGIN}\r\nnew\r\n${END}\r\n\r\nmore\r\n`);
  });
});

describe('readManagedBlock', () => {
  it('returns null for a missing file', () => {
    expect(readManagedBlock(join(tmp, 'nope.md'))).toBeNull();
  });

  it('returns null for a file without markers', () => {
    const file = join(tmp, 'README.md');
    writeFileSync(file, 'no markers here', 'utf8');
    expect(readManagedBlock(file)).toBeNull();
  });

  it('returns the inner content when markers are present', () => {
    const file = join(tmp, 'AGENTS.md');
    writeManagedBlock(file, 'line 1\nline 2', { createIfMissing: true });
    expect(readManagedBlock(file)).toBe('line 1\nline 2');
  });
});

describe('removeManagedBlock', () => {
  it('returns "absent" when the file has no block', () => {
    const file = join(tmp, 'README.md');
    writeFileSync(file, 'nothing to remove', 'utf8');
    expect(removeManagedBlock(file)).toBe('absent');
    expect(readFileSync(file, 'utf8')).toBe('nothing to remove');
  });

  it('removes a block while preserving surrounding content', () => {
    const file = join(tmp, 'AGENTS.md');
    writeFileSync(file, `top\n\n${BEGIN}\nmanaged\n${END}\n\nbottom\n`, 'utf8');
    expect(removeManagedBlock(file)).toBe('removed');
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('top');
    expect(text).toContain('bottom');
    expect(text).not.toContain(BEGIN);
  });

  it('leaves the file empty when the block was the only content', () => {
    const file = join(tmp, 'AGENTS.md');
    writeManagedBlock(file, 'solo', { createIfMissing: true });
    expect(removeManagedBlock(file)).toBe('removed');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('');
  });
});
