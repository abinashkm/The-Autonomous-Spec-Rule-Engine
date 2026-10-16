import { startStdioServer } from '@specgate/mcp';

/**
 * `specgate mcp` — start the MCP stdio server for the current repo.
 * Blocks until the client disconnects or the process is killed.
 */
export async function mcpCommand(options: {
  readonly cwd: string;
  readonly version: string;
}): Promise<number> {
  try {
    await startStdioServer({ cwd: options.cwd, version: options.version });
    return 0;
  } catch (err) {
    process.stderr.write(`specgate mcp: ${(err as Error).message}\n`);
    return 2;
  }
}
