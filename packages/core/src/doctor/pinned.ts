/**
 * Pinned download table for `specgate doctor --install` (ADR-015).
 *
 * Each entry declares an exact URL + SHA-256 per platform. We refuse to
 * download anything whose checksum does not match. **Never update without a
 * matching PR to run.md's reference-projects table.**
 *
 * Checksum verification is enforced in `install.ts`; this file is pure data.
 *
 * NOTE for maintainers: the SHA-256 strings below are placeholders. Before
 * cutting a release that enables `doctor --install`, replace them with the
 * real digests published by each upstream tool. The CI job
 * `verify-pinned-downloads.yml` will re-fetch each URL and compare, failing
 * the pipeline on drift.
 */

export type Platform = 'linux-x64' | 'linux-arm64' | 'darwin-x64' | 'darwin-arm64' | 'win32-x64';

export interface PinnedTool {
  readonly tool: string;
  readonly version: string;
  readonly downloads: Readonly<
    Partial<
      Record<
        Platform,
        { readonly url: string; readonly sha256: string; readonly archive?: 'tar.gz' | 'zip' }
      >
    >
  >;
}

export const PINNED_TOOLS: readonly PinnedTool[] = [
  {
    tool: 'gitleaks',
    version: '8.18.4',
    downloads: {
      'linux-x64': {
        url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.18.4/gitleaks_8.18.4_linux_x64.tar.gz',
        sha256: 'PLACEHOLDER_FILL_ON_RELEASE_LINUX_X64',
        archive: 'tar.gz',
      },
      'linux-arm64': {
        url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.18.4/gitleaks_8.18.4_linux_arm64.tar.gz',
        sha256: 'PLACEHOLDER_FILL_ON_RELEASE_LINUX_ARM64',
        archive: 'tar.gz',
      },
      'darwin-x64': {
        url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.18.4/gitleaks_8.18.4_darwin_x64.tar.gz',
        sha256: 'PLACEHOLDER_FILL_ON_RELEASE_DARWIN_X64',
        archive: 'tar.gz',
      },
      'darwin-arm64': {
        url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.18.4/gitleaks_8.18.4_darwin_arm64.tar.gz',
        sha256: 'PLACEHOLDER_FILL_ON_RELEASE_DARWIN_ARM64',
        archive: 'tar.gz',
      },
      'win32-x64': {
        url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.18.4/gitleaks_8.18.4_windows_x64.zip',
        sha256: 'PLACEHOLDER_FILL_ON_RELEASE_WIN32_X64',
        archive: 'zip',
      },
    },
  },
  {
    tool: 'osv-scanner',
    version: '1.9.1',
    downloads: {
      'linux-x64': {
        url: 'https://github.com/google/osv-scanner/releases/download/v1.9.1/osv-scanner_linux_amd64',
        sha256: 'PLACEHOLDER_FILL_ON_RELEASE_OSV_LINUX_X64',
      },
      'linux-arm64': {
        url: 'https://github.com/google/osv-scanner/releases/download/v1.9.1/osv-scanner_linux_arm64',
        sha256: 'PLACEHOLDER_FILL_ON_RELEASE_OSV_LINUX_ARM64',
      },
      'darwin-x64': {
        url: 'https://github.com/google/osv-scanner/releases/download/v1.9.1/osv-scanner_darwin_amd64',
        sha256: 'PLACEHOLDER_FILL_ON_RELEASE_OSV_DARWIN_X64',
      },
      'darwin-arm64': {
        url: 'https://github.com/google/osv-scanner/releases/download/v1.9.1/osv-scanner_darwin_arm64',
        sha256: 'PLACEHOLDER_FILL_ON_RELEASE_OSV_DARWIN_ARM64',
      },
      'win32-x64': {
        url: 'https://github.com/google/osv-scanner/releases/download/v1.9.1/osv-scanner_windows_amd64.exe',
        sha256: 'PLACEHOLDER_FILL_ON_RELEASE_OSV_WIN32_X64',
      },
    },
  },
] as const;

export function currentPlatform(): Platform | null {
  const arch = process.arch;
  switch (process.platform) {
    case 'linux':
      if (arch === 'x64') return 'linux-x64';
      if (arch === 'arm64') return 'linux-arm64';
      return null;
    case 'darwin':
      if (arch === 'x64') return 'darwin-x64';
      if (arch === 'arm64') return 'darwin-arm64';
      return null;
    case 'win32':
      if (arch === 'x64') return 'win32-x64';
      return null;
    default:
      return null;
  }
}
