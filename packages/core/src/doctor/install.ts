import { createHash } from 'node:crypto';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { currentPlatform, PINNED_TOOLS, type PinnedTool } from './pinned.js';

/**
 * Managed tool installer.
 * Source of truth: run.md §24.3 + ADR-015.
 *
 * Behaviour:
 *   - Requires explicit `consent: true` from the CLI (humans see a prompt).
 *   - Downloads to ~/.specgate/bin/<tool> after verifying SHA-256.
 *   - Never downloads anything whose checksum is still the placeholder — the
 *     release pipeline flips those to real digests before publishing.
 *   - Returns an action log for the CLI to print.
 */

export interface InstallToolsOptions {
  readonly tools?: readonly string[]; // defaults to all pinned tools
  readonly consent: boolean;
  readonly dryRun?: boolean;
  /** Override fetch for tests. */
  readonly fetchFn?: (url: string) => Promise<ReadableStreamFetchResponse>;
  /** Pin directory (default: ~/.specgate/bin). */
  readonly binDir?: string;
}

export type InstallActionKind = 'installed' | 'skipped' | 'error' | 'placeholder-digest';

export interface InstallAction {
  readonly tool: string;
  readonly version: string;
  readonly platform: string;
  readonly target: string;
  readonly action: InstallActionKind;
  readonly note?: string;
}

export interface InstallToolsResult {
  readonly binDir: string;
  readonly actions: readonly InstallAction[];
}

export interface ReadableStreamFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: NodeJS.ReadableStream | null;
}

export const INSTALL_BIN_DIR = join(homedir(), '.specgate', 'bin');

const PLACEHOLDER_PREFIX = 'PLACEHOLDER_';

async function sha256File(path: string): Promise<string> {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function downloadTo(
  url: string,
  destPath: string,
  fetchFn: InstallToolsOptions['fetchFn'],
): Promise<void> {
  const impl =
    fetchFn ??
    (async (u) => {
      const r = await fetch(u);
      return {
        ok: r.ok,
        status: r.status,
        body: r.body as unknown as NodeJS.ReadableStream | null,
      };
    });
  const r = await impl(url);
  if (!r.ok || !r.body) throw new Error(`download failed: HTTP ${r.status}`);
  mkdirSync(join(destPath, '..'), { recursive: true });
  await pipeline(r.body, createWriteStream(destPath));
}

/** Install `tools` (default: all pinned tools) for the current platform. */
export async function installPinnedTools(
  options: InstallToolsOptions,
): Promise<InstallToolsResult> {
  const binDir = options.binDir ?? INSTALL_BIN_DIR;
  const platform = currentPlatform();
  const actions: InstallAction[] = [];
  if (!platform) {
    return {
      binDir,
      actions: [
        {
          tool: '(detect)',
          version: '',
          platform: `${process.platform}-${process.arch}`,
          target: '',
          action: 'error',
          note: 'Unsupported platform/arch combination for pinned downloads.',
        },
      ],
    };
  }
  if (!options.consent) {
    return {
      binDir,
      actions: PINNED_TOOLS.map((t) => ({
        tool: t.tool,
        version: t.version,
        platform,
        target: join(binDir, t.tool),
        action: 'skipped',
        note: 'consent: false — pass --install (CLI) or {consent: true} (core) to confirm.',
      })),
    };
  }

  mkdirSync(binDir, { recursive: true });

  const filter = options.tools ? new Set(options.tools) : null;
  const toInstall: PinnedTool[] = PINNED_TOOLS.filter((t) => !filter || filter.has(t.tool));

  for (const tool of toInstall) {
    const dl = tool.downloads[platform];
    if (!dl) {
      actions.push({
        tool: tool.tool,
        version: tool.version,
        platform,
        target: '',
        action: 'skipped',
        note: `no pinned download for ${platform}`,
      });
      continue;
    }
    if (dl.sha256.startsWith(PLACEHOLDER_PREFIX)) {
      actions.push({
        tool: tool.tool,
        version: tool.version,
        platform,
        target: '',
        action: 'placeholder-digest',
        note: 'Pinned SHA-256 is still the release-pipeline placeholder; refusing to download.',
      });
      continue;
    }

    const targetName = tool.tool + (platform === 'win32-x64' ? '.exe' : '');
    const targetPath = join(binDir, targetName);
    if (options.dryRun) {
      actions.push({
        tool: tool.tool,
        version: tool.version,
        platform,
        target: targetPath,
        action: 'skipped',
        note: 'dryRun: true',
      });
      continue;
    }

    const tmpDownload = targetPath + '.part';
    try {
      await downloadTo(dl.url, tmpDownload, options.fetchFn);
      const actualDigest = await sha256File(tmpDownload);
      if (actualDigest.toLowerCase() !== dl.sha256.toLowerCase()) {
        rmSync(tmpDownload, { force: true });
        actions.push({
          tool: tool.tool,
          version: tool.version,
          platform,
          target: targetPath,
          action: 'error',
          note: `checksum mismatch — expected ${dl.sha256}, got ${actualDigest}`,
        });
        continue;
      }

      // Archive handling is deferred: for the two tools pinned today, `gitleaks`
      // ships as .tar.gz / .zip and `osv-scanner` ships as a bare binary. The
      // extraction logic lands with the real pipeline (see
      // packages/distribution/scripts/README.md for the plan). For now, when
      // `archive` is set we leave the archive on disk and label the action.
      if (dl.archive) {
        renameSync(tmpDownload, targetPath + '.' + dl.archive);
        actions.push({
          tool: tool.tool,
          version: tool.version,
          platform,
          target: targetPath + '.' + dl.archive,
          action: 'installed',
          note: `archive dropped at ${targetPath}.${dl.archive}; manual extract needed in M8 (release-pipeline work).`,
        });
      } else {
        renameSync(tmpDownload, targetPath);
        if (process.platform !== 'win32') {
          try {
            chmodSync(targetPath, 0o755);
          } catch {
            /* ignore */
          }
        }
        actions.push({
          tool: tool.tool,
          version: tool.version,
          platform,
          target: targetPath,
          action: 'installed',
        });
      }
    } catch (err) {
      rmSync(tmpDownload, { force: true });
      actions.push({
        tool: tool.tool,
        version: tool.version,
        platform,
        target: targetPath,
        action: 'error',
        note: (err as Error).message,
      });
    }
  }

  return { binDir, actions };
}

/** Helper: `~/.specgate/bin` so the CLI can suggest adding it to PATH. */
export function hasBinaryInstalled(name: string, binDir = INSTALL_BIN_DIR): boolean {
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  return suffixes.some((s) => existsSync(join(binDir, name + s)));
}
