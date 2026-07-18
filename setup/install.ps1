# setup/install.ps1 — standalone bootstrapper for anotifier on Windows.
# Intended to be piped:  irm .../setup/install.ps1 | iex
# It verifies Node >= 18 and npm are present, then hands off to the real setup
# wizard via `npx anotifier@latest setup`, forwarding any extra args.
#
# $ErrorActionPreference = 'Stop' is deliberate: a bootstrapper people pipe into a
# shell must fail LOUDLY and stop — never silently no-op — if a prerequisite is missing.
$ErrorActionPreference = 'Stop'

function Fail($msg) {
  Write-Host "`nanotifier install failed: $msg" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js 18+ is required but 'node' was not found. Install it from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then re-run this installer."
}

$nodeMajor = 0
try { $nodeMajor = [int](node -p 'process.versions.node.split(".")[0]') } catch { $nodeMajor = 0 }
if ($nodeMajor -lt 18) {
  Fail "Node.js 18+ is required (found $(node -v)). Upgrade Node, then re-run this installer."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm is required but was not found (it ships with Node.js). Reinstall Node 18+ from https://nodejs.org"
}

Write-Host "Node $(node -v) and npm $(npm -v) detected - launching anotifier setup..."
& npx --yes anotifier@latest setup @args
exit $LASTEXITCODE
