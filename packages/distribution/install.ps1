# SpecGate Windows install script.
#
#   iwr -useb https://specgate.dev/install.ps1 | iex
#
# What it does:
#   1. Detect arch (x64 only today).
#   2. Fetch the matching .exe from the GitHub release matching $env:SPECGATE_VERSION
#      (default: the "latest" tag).
#   3. Verify SHA-256 against checksums.txt.
#   4. Install to $env:SPECGATE_INSTALL_DIR (default: %LOCALAPPDATA%\specgate).
#   5. Add that dir to the current session PATH (persistent setup is up to the user).

[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

$repo = 'specgate/specgate'
$version = if ($env:SPECGATE_VERSION) { $env:SPECGATE_VERSION } else { 'latest' }
$installDir = if ($env:SPECGATE_INSTALL_DIR) { $env:SPECGATE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'specgate' }

if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'specgate: only 64-bit Windows is supported.'
}

if ($version -eq 'latest') {
  $apiUrl = "https://api.github.com/repos/$repo/releases/latest"
  $tag = (Invoke-RestMethod -Uri $apiUrl -UseBasicParsing).tag_name
} else {
  $tag = $version
}
$asset = 'specgate-win32-x64.exe'
$base = "https://github.com/$repo/releases/download/$tag"
$binUrl = "$base/$asset"
$sumUrl = "$base/checksums.txt"

$tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP ("specgate-" + [System.Guid]::NewGuid().ToString('n')))
try {
  $localBin = Join-Path $tmp.FullName $asset
  Invoke-WebRequest -Uri $binUrl -OutFile $localBin -UseBasicParsing
  $localSum = Join-Path $tmp.FullName 'checksums.txt'
  Invoke-WebRequest -Uri $sumUrl -OutFile $localSum -UseBasicParsing

  $expected = (Select-String -Path $localSum -Pattern "\s$asset\s*$" | ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1)
  if (-not $expected) { throw "specgate: no checksum entry for $asset in checksums.txt" }
  $actual = (Get-FileHash -Algorithm SHA256 -Path $localBin).Hash.ToLower()
  if ($expected.ToLower() -ne $actual) {
    throw "specgate: checksum mismatch (expected $expected, got $actual)"
  }

  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  $target = Join-Path $installDir 'specgate.exe'
  Move-Item -Force $localBin $target

  $env:PATH = "$installDir;$env:PATH"
  Write-Host "specgate: installed to $target"
  Write-Host "specgate: PATH updated for THIS session. Add $installDir to your PATH to persist."
  Write-Host "specgate: verify with 'specgate --version'"
} finally {
  Remove-Item -Force -Recurse -Path $tmp.FullName -ErrorAction SilentlyContinue
}
