#!/usr/bin/env sh
# SpecGate POSIX install script.
#
#   curl -fsSL https://specgate.dev/install.sh | sh
#
# What it does:
#   1. Detect OS + arch
#   2. Fetch the matching standalone binary from the GitHub release matching
#      the SPECGATE_VERSION env var (default: the "latest" tag).
#   3. Verify the SHA-256 against the checksums file.
#   4. Install to $SPECGATE_INSTALL_DIR (default: /usr/local/bin).
#
# Opt-outs: everything is overrideable via env vars; no hidden telemetry.

set -eu

REPO="specgate/specgate"
VERSION="${SPECGATE_VERSION:-latest}"
INSTALL_DIR="${SPECGATE_INSTALL_DIR:-/usr/local/bin}"
TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t specgate)"
trap 'rm -rf "$TMP_DIR"' EXIT

say() { printf 'specgate: %s\n' "$1"; }
die() { say "ERROR: $1" >&2; exit 1; }

uname_s="$(uname -s)"
uname_m="$(uname -m)"
case "$uname_s" in
  Linux)   os=linux ;;
  Darwin)  os=darwin ;;
  *) die "unsupported OS: $uname_s" ;;
esac
case "$uname_m" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) die "unsupported arch: $uname_m" ;;
esac
asset="specgate-${os}-${arch}"

if [ "$VERSION" = "latest" ]; then
  tag_url="https://api.github.com/repos/${REPO}/releases/latest"
  tag="$(curl -fsSL "$tag_url" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$tag" ] || die "could not determine latest tag from $tag_url"
else
  tag="$VERSION"
fi

base="https://github.com/${REPO}/releases/download/${tag}"
bin_url="${base}/${asset}"
sum_url="${base}/checksums.txt"

say "installing ${asset} ${tag} → ${INSTALL_DIR}"

curl -fsSL "$bin_url" -o "${TMP_DIR}/${asset}"
curl -fsSL "$sum_url" -o "${TMP_DIR}/checksums.txt"

expected="$(awk -v name="$asset" '$2==name {print $1}' "${TMP_DIR}/checksums.txt")"
[ -n "$expected" ] || die "no checksum entry for $asset in checksums.txt"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${TMP_DIR}/${asset}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "${TMP_DIR}/${asset}" | awk '{print $1}')"
else
  die "need sha256sum or shasum to verify the download"
fi
[ "$expected" = "$actual" ] || die "checksum mismatch (expected $expected, got $actual)"

install_dest="${INSTALL_DIR}/specgate"
chmod +x "${TMP_DIR}/${asset}"
if ! mv "${TMP_DIR}/${asset}" "$install_dest" 2>/dev/null; then
  say "trying sudo install (write to $INSTALL_DIR requires elevated privileges)"
  sudo mv "${TMP_DIR}/${asset}" "$install_dest"
fi

say "installed → $install_dest"
say "verify: specgate --version"
