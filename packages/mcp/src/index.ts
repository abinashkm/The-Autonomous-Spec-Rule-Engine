import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  getActiveSpec,
  getRule,
  getSpecMarkdown,
  getStatusResource,
  getTaskContext,
  listAllTasks,
  PRODUCT_NAME,
  proposeSpecChange,
  resolveConfig,
  runMcpCheck,
  updateTaskStatus,
} from '@specgate/core';

/**
 * SpecGate MCP server adapter.
 * Source of truth: run.md §9.2.
 *
 * All business logic lives in `@specgate/core`. This file is a thin wiring
 * between the MCP SDK's `registerTool` / `registerResource` and the pure
 * functions in `packages/core/src/mcp/tools.ts`.
 */

export interface BuildServerOptions {
  readonly cwd: string;
  readonly version?: string;
}

function textResult(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

export function buildMcpServer(options: BuildServerOptions): McpServer {
  const cwd = options.cwd;
  const server = new McpServer({
    name: PRODUCT_NAME.toLowerCase(),
    version: options.version ?? '0.0.0',
  });

  /* --------------------------- tools (run.md §9.2) ----------------------- */

  server.registerTool(
    'get_active_spec',
    {
      title: 'Get the currently active spec',
      description:
        'Returns the newest approved (or implemented) spec with its parsed requirements. Falls back to the newest draft when nothing is approved yet.',
      inputSchema: {},
    },
    () => textResult(getActiveSpec(cwd)),
  );

  server.registerTool(
    'get_task_context',
    {
      title: 'Get task-scoped context',
      description:
        'Returns the task, the acceptance criteria it implements, the rules that match its tags/globs, and a token-budgeted context window.',
      inputSchema: {
        task_id: z.string().regex(/^T-\d{3}$/),
        max_tokens: z.number().int().min(100).max(100000).optional(),
      },
    },
    (args) =>
      textResult(
        getTaskContext({
          cwd,
          taskId: args.task_id,
          ...(args.max_tokens !== undefined ? { maxTokens: args.max_tokens } : {}),
        }),
      ),
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks across all specs',
      description: 'Lists tasks; optionally filtered by done=true/false.',
      inputSchema: {
        done: z.boolean().optional(),
      },
    },
    (args) =>
      textResult(listAllTasks(cwd, args.done !== undefined ? { done: args.done } : undefined)),
  );

  server.registerTool(
    'update_task',
    {
      title: "Update a task's done status",
      description:
        "Toggles a task's checkbox. Marking a task done requires that a test file references at least one of the task's acceptance-criterion ids.",
      inputSchema: {
        task_id: z.string().regex(/^T-\d{3}$/),
        done: z.boolean(),
      },
    },
    (args) => {
      try {
        const r = updateTaskStatus({ cwd, taskId: args.task_id, done: args.done });
        return textResult({ ok: true, task: r.task, path: r.path });
      } catch (err) {
        return textResult({
          ok: false,
          error: (err as Error).name,
          code: (err as { code?: string }).code ?? 'E_UNKNOWN',
          message: (err as Error).message,
        });
      }
    },
  );

  server.registerTool(
    'check',
    {
      title: 'Run SpecGate gates',
      description:
        'Runs the gate suite and returns normalised GateResult[] plus a correction prompt (text + payload) when there are blocking failures.',
      inputSchema: {
        scope: z.enum(['staged', 'changed', 'full']).optional(),
        gates: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const r = await runMcpCheck({
        cwd,
        ...(args.scope ? { scope: args.scope } : {}),
        ...(args.gates ? { gates: args.gates } : {}),
      });
      return textResult(r);
    },
  );

  server.registerTool(
    'get_rule',
    {
      title: 'Get a rule by id',
      description: 'Looks up a rule across installed packs under .specgate/rules.',
      inputSchema: {
        rule_id: z.string().min(1),
      },
    },
    (args) => textResult(getRule(cwd, args.rule_id)),
  );

  server.registerTool(
    'propose_spec_change',
    {
      title: 'Propose a change to a spec (requires human approval)',
      description:
        'Writes a proposal under .specgate/specs/<id>/proposals/. Never modifies the live spec — a human runs `specgate spec accept-proposal` to merge.',
      inputSchema: {
        spec_id: z.string().min(1),
        title: z.string().min(1),
        body: z.string().min(1),
        submitted_by: z.string().optional(),
      },
    },
    (args) => {
      try {
        const r = proposeSpecChange({
          cwd,
          specIdOrName: args.spec_id,
          proposal: {
            specId: args.spec_id,
            title: args.title,
            body: args.body,
            ...(args.submitted_by ? { submittedBy: args.submitted_by } : {}),
          },
        });
        return textResult({ ok: true, path: r.path });
      } catch (err) {
        return textResult({ ok: false, message: (err as Error).message });
      }
    },
  );

  /* --------------------- resources (run.md §9.2) ------------------------- */

  server.resource('specgate-status', 'specgate://status', { mimeType: 'application/json' }, () => ({
    contents: [
      {
        uri: 'specgate://status',
        mimeType: 'application/json',
        text: JSON.stringify(getStatusResource(cwd), null, 2),
      },
    ],
  }));

  // specgate://spec/{id} — resource template.
  server.resource('specgate-spec', 'specgate://spec/{id}', { mimeType: 'text/markdown' }, (uri) => {
    const id = uri.pathname.replace(/^\//, '');
    const body = getSpecMarkdown(cwd, id);
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/markdown',
          text: body ?? `# spec ${id} not found\n`,
        },
      ],
    };
  });

  // specgate://rules/{id} — resource template.
  server.resource(
    'specgate-rule',
    'specgate://rules/{id}',
    { mimeType: 'application/json' },
    (uri) => {
      const id = uri.pathname.replace(/^\//, '');
      const rule = getRule(cwd, id);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(rule, null, 2),
          },
        ],
      };
    },
  );

  // Keep a reference to resolveConfig so unused-import lint stays quiet; it's
  // used indirectly by getStatusResource. Also useful for future diagnostics.
  void resolveConfig;

  return server;
}

/**
 * Start the server on stdio. Called by the `specgate mcp` CLI.
 */
export async function startStdioServer(options: BuildServerOptions): Promise<void> {
  const server = buildMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Allow running this file directly: `node packages/mcp/dist/index.js`.
// Robust main-module check that works on Windows (file:// prefix + drive
// letter + backslashes) and POSIX.
import { fileURLToPath as _fileURLToPath } from 'node:url';
try {
  const thisFile = _fileURLToPath(import.meta.url);
  const argvFile = process.argv[1] ?? '';
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
  if (norm(thisFile) === norm(argvFile)) {
    startStdioServer({ cwd: process.cwd() }).catch((err: unknown) => {
      process.stderr.write(`specgate mcp: ${(err as Error).message}\n`);
      process.exit(1);
    });
  }
} catch {
  /* not a file:// URL, skip */
}
