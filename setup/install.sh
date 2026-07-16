#!/usr/bin/env bash
# setup/install.sh — standalone bootstrapper for ai-agent-notifier (no git clone).
# Intended to be piped:  curl -fsSL .../setup/install.sh | bash
# It verifies Node >= 18 and npm are present, then hands off to the real setup
# wizard via `npx ai-agent-notifier@latest setup`, forwarding any extra args.
#
# `set -euo pipefail` is deliberate: a bootstrapper people pipe into a shell must
# fail LOUDLY and stop — never silently no-op — if a prerequisite is missing.
set -euo pipefail

err() {
  printf '\n\033[31mai-agent-notifier install failed:\033[0m %s\n' "$1" >&2
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  err "Node.js 18+ is required but 'node' was not found.
  macOS:  brew install node
  Linux:  install via your package manager, or see https://nodejs.org
Then re-run this installer."
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js 18+ is required (found $(node -v)). Upgrade Node, then re-run this installer."
fi

if ! command -v npm >/dev/null 2>&1; then
  err "npm is required but was not found (it ships with Node.js). Reinstall Node 18+ from https://nodejs.org"
fi

echo "Node $(node -v) and npm $(npm -v) detected — launching ai-agent-notifier setup..."
exec npx --yes ai-agent-notifier@latest setup "$@"
