import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseGo,
  parseJsTs,
  parsePython,
  scanRepoForAcAnnotations,
} from '../../src/trace/annotations.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-ann-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('parseJsTs', () => {
  it('matches `@spec AC-xxx.y` in `//` comments and `/* */` blocks', () => {
    const text = [
      `// @spec AC-001.1`,
      `const x = 1;`,
      `/*`,
      ` * @spec AC-002.3`,
      ` */`,
      `const y = 2;`,
    ].join('\n');
    const hits = parseJsTs('src/a.ts', text);
    expect(hits.map((h) => h.acId).sort()).toEqual(['AC-001.1', 'AC-002.3']);
    expect(hits[0]!.source).toBe('comment');
  });

  it('matches `it("AC-xxx.y: title")` and `describe("AC-xxx.y", ...)`', () => {
    const text = [
      `import { it, describe } from 'vitest';`,
      `describe('AC-001.1', () => {`,
      `  it("AC-001.2: zero rows", () => {});`,
      `});`,
    ].join('\n');
    const hits = parseJsTs('test/a.test.ts', text);
    const ids = hits.map((h) => h.acId).sort();
    expect(ids).toEqual(['AC-001.1', 'AC-001.2']);
    expect(hits.every((h) => h.source === 'test-name')).toBe(true);
  });

  it('skips strings that mention AC-xxx but are not inside comments / test names', () => {
    const text = `const msg = "deprecated AC-001.1 handling";\n`;
    const hits = parseJsTs('src/x.ts', text);
    expect(hits).toEqual([]);
  });
});

describe('parsePython', () => {
  it('matches `# @spec AC-xxx.y` + `@pytest.mark.spec(...)` + `def test_AC_...`', () => {
    const text = [
      `# @spec AC-001.1`,
      `import pytest`,
      ``,
      `@pytest.mark.spec("AC-002.1")`,
      `def test_feature():`,
      `    pass`,
      ``,
      `def test_AC_003_7_edge():`,
      `    pass`,
    ].join('\n');
    const hits = parsePython('tests/test_foo.py', text);
    const ids = hits.map((h) => h.acId).sort();
    expect(ids).toEqual(['AC-001.1', 'AC-002.1', 'AC-003.7']);
    expect(hits.find((h) => h.acId === 'AC-002.1')!.source).toBe('pytest-mark');
    expect(hits.find((h) => h.acId === 'AC-003.7')!.source).toBe('test-name');
  });
});

describe('parseGo', () => {
  it('matches comment ids and `func Test_AC_xxx_y...`', () => {
    const text = [
      `// @spec AC-001.2`,
      `package foo`,
      ``,
      `func Test_AC_001_1_HeaderRow(t *testing.T) {}`,
      `func Test_AC_002_3Extra(t *testing.T) {}`,
    ].join('\n');
    const hits = parseGo('foo/foo_test.go', text);
    const ids = hits.map((h) => h.acId).sort();
    expect(ids).toEqual(['AC-001.1', 'AC-001.2', 'AC-002.3']);
  });
});

describe('scanRepoForAcAnnotations', () => {
  it('scans only known test file types and returns deterministic order', () => {
    mkdirSync(join(tmp, 'test'), { recursive: true });
    mkdirSync(join(tmp, 'tests'), { recursive: true });
    writeFileSync(join(tmp, 'test', 'b.test.ts'), `it('AC-002.1: alpha', () => {});\n`, 'utf8');
    writeFileSync(join(tmp, 'tests', 'test_x.py'), `# @spec AC-001.1\n`, 'utf8');
    writeFileSync(join(tmp, 'README.md'), '# unrelated', 'utf8');
    const hits = scanRepoForAcAnnotations(tmp);
    const ids = hits.map((h) => h.acId).sort();
    expect(ids).toEqual(['AC-001.1', 'AC-002.1']);
    const files = hits.map((h) => h.file).sort();
    expect(files).toContain('test/b.test.ts');
    expect(files).toContain('tests/test_x.py');
  });

  it('skips node_modules, .git, .specgate', () => {
    for (const d of ['node_modules', '.git', '.specgate']) {
      mkdirSync(join(tmp, d), { recursive: true });
      writeFileSync(join(tmp, d, 'x.test.ts'), `it('AC-999.9', () => {});`, 'utf8');
    }
    expect(scanRepoForAcAnnotations(tmp)).toEqual([]);
  });
});
