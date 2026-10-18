import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ENTRY = resolve(__dirname, '..', 'dist', 'index.js');

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-mcp-srv-'));
});

afterEach(async () => {
  // On Windows, the spawned stdio server may still hold a handle on `tmp`
  // when SIGTERM returns. Retry rmSync a few times before giving up.
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(tmp, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

interface JsonRpcResult {
  readonly id: number;
  readonly result?: {
    readonly tools?: Array<{ name: string }>;
    readonly resources?: Array<{ name: string }>;
    readonly [k: string]: unknown;
  };
  readonly error?: unknown;
}

/**
 * Spawn the stdio server, send a sequence of JSON-RPC requests, and return
 * the ordered results. Keeps the test synchronous and single-process.
 */
async function talkToServer(
  requests: ReadonlyArray<Record<string, unknown>>,
  cwd: string,
): Promise<JsonRpcResult[]> {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const results: JsonRpcResult[] = [];
  const done = new Promise<void>((resolveP) => {
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as JsonRpcResult;
          if (typeof parsed.id === 'number') {
            results.push(parsed);
            if (results.length === requests.length) resolveP();
          }
        } catch {
          /* ignore non-JSON lines */
        }
      }
    });
    child.on('exit', () => resolveP());
  });

  for (const req of requests) {
    child.stdin!.write(JSON.stringify(req) + '\n');
  }
  // Wait up to ~20 s for all expected replies. Cold Node startup under
  // parallel vitest load (and CI runners) can push the stdio server's first
  // response well past the few-hundred-millisecond warm case.
  const timeout = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('timeout waiting for MCP responses')), 20_000);
  });
  try {
    await Promise.race([done, timeout]);
  } finally {
    child.stdin!.end();
    child.kill('SIGTERM');
  }
  return results;
}

describe('SpecGate MCP server (stdio)', () => {
  it('responds to initialize + tools/list with the 7 run.md §9.2 tools', async () => {
    const results = await talkToServer(
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'specgate-test', version: '0.0.0' },
          },
        },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        { jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} },
      ],
      tmp,
    );
    expect(results.length).toBeGreaterThanOrEqual(2);
    const toolsReply = results.find((r) => r.id === 2);
    expect(toolsReply?.result?.tools).toBeDefined();
    const names = (toolsReply!.result!.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual([
      'check',
      'get_active_spec',
      'get_rule',
      'get_task_context',
      'list_tasks',
      'propose_spec_change',
      'update_task',
    ]);

    const resourcesReply = results.find((r) => r.id === 3);
    const resources = (resourcesReply?.result?.resources ?? []) as Array<{ name: string }>;
    const rnames = resources.map((r) => r.name);
    expect(rnames).toContain('specgate-status');
  });

  it('calling get_active_spec on an empty repo returns null', async () => {
    const results = await talkToServer(
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'specgate-test', version: '0.0.0' },
          },
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'get_active_spec', arguments: {} },
        },
      ],
      tmp,
    );
    const reply = results.find((r) => r.id === 2);
    const content =
      (reply?.result as { content: Array<{ text: string }> } | undefined)?.content ?? [];
    expect(content[0]?.text).toBe('null');
  });
});
