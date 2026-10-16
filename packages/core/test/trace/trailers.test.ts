import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../src/subprocess/run.js';
import { parseCommitTrailer, parseTrailers } from '../../src/trace/trailers.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-trail-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('parseCommitTrailer (pure)', () => {
  it('extracts unique REQ / T / AC ids from a Spec: line', () => {
    const msg = ['feat: x', '', 'body', '', 'Spec: REQ-001, T-002, AC-001.1, REQ-001'].join('\n');
    const r = parseCommitTrailer(msg);
    expect(r.reqIds).toEqual(['REQ-001']);
    expect(r.taskIds).toEqual(['T-002']);
    expect(r.acIds).toEqual(['AC-001.1']);
  });

  it('returns empty arrays when no trailer is present', () => {
    expect(parseCommitTrailer('nothing here')).toEqual({ reqIds: [], taskIds: [], acIds: [] });
  });
});

describe('parseTrailers (git integration)', () => {
  it('returns [] on an uninitialised repo', async () => {
    expect(await parseTrailers({ cwd: tmp })).toEqual([]);
  });

  it('reads real commit messages and returns the referenced ids', async () => {
    await run('git', ['init', '-q'], { cwd: tmp });
    await run('git', ['config', 'user.email', 't@example.com'], { cwd: tmp });
    await run('git', ['config', 'user.name', 'tester'], { cwd: tmp });
    await run('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmp });
    writeFileSync(join(tmp, 'a.txt'), 'hello\n', 'utf8');
    await run('git', ['add', '.'], { cwd: tmp });
    await run('git', ['commit', '-q', '-m', 'first commit\n\nSpec: REQ-001, AC-001.1'], {
      cwd: tmp,
    });
    writeFileSync(join(tmp, 'b.txt'), 'world\n', 'utf8');
    await run('git', ['add', '.'], { cwd: tmp });
    await run('git', ['commit', '-q', '-m', 'second commit\n\nno trailer here'], { cwd: tmp });
    const commits = await parseTrailers({ cwd: tmp });
    expect(commits).toHaveLength(1);
    expect(commits[0]!.reqIds).toEqual(['REQ-001']);
    expect(commits[0]!.acIds).toEqual(['AC-001.1']);
    expect(commits[0]!.sha).toHaveLength(40);
  });
});
