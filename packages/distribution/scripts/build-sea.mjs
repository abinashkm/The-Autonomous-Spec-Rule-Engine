#!/usr/bin/env node
/**
 * Build Node Single Executable Applications (SEA) for every target in
 * `TARGETS`. Run inside the release pipeline AFTER `pnpm build`.
 *
 * The implementation uses `postject` to inject the SEA blob into a copy of
 * the host Node binary, then renames the file for each target. Because we
 * can only produce a binary for the host OS/arch from this script, the full
 * matrix is driven from CI (`.github/workflows/release.yml`) spawning one
 * runner per OS.
 *
 * Reference: https://nodejs.org/api/single-executable-applications.html
 */

import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const BIN_DIR = join(DIST, 'bin');

const CLI_ENTRY = resolve(__dirname, '..', '..', 'cli', 'dist', 'index.js');

if (!existsSync(CLI_ENTRY)) {
  console.error(
    `[build-sea] CLI entry not found at ${CLI_ENTRY}. Run \`pnpm -F @specgate/cli build\` first.`,
  );
  process.exit(1);
}

mkdirSync(BIN_DIR, { recursive: true });

const seaConfig = {
  main: CLI_ENTRY,
  output: join(DIST, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
};
const seaConfigPath = join(DIST, 'sea-config.json');
writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
  stdio: 'inherit',
});

const host = `${process.platform}-${process.arch}`;
const outName = host === 'win32-x64' ? `specgate-${host}.exe` : `specgate-${host}`;
const outPath = join(BIN_DIR, outName);

copyFileSync(process.execPath, outPath);
if (process.platform !== 'win32') chmodSync(outPath, 0o755);

execFileSync(
  'npx',
  [
    '-y',
    'postject',
    outPath,
    'NODE_SEA_BLOB',
    seaConfig.output,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
  ],
  { stdio: 'inherit' },
);

const digest = createHash('sha256').update(readFileSync(outPath)).digest('hex');
const checksumPath = join(DIST, 'checksums.txt');
const line = `${digest}  ${outName}\n`;
if (existsSync(checksumPath)) {
  const existing = readFileSync(checksumPath, 'utf8');
  writeFileSync(
    checksumPath,
    existing
      .split('\n')
      .filter((l) => !l.endsWith(outName) && l.trim().length > 0)
      .concat([line.trim()])
      .join('\n') + '\n',
  );
} else {
  writeFileSync(checksumPath, line);
}

rmSync(seaConfig.output, { force: true });
rmSync(seaConfigPath, { force: true });

console.log(`[build-sea] wrote ${outPath}`);
console.log(`[build-sea] sha256 ${digest}`);
