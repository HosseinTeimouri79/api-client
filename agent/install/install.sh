#!/bin/sh
# API Client Local Agent installer for Linux and macOS (no root needed; everything is installed for the current user).
#   curl -fsSL __SERVER__/agent/install.sh | sh
#   curl -fsSL __SERVER__/agent/install.sh | sh -s -- --port 47900
set -eu
SERVER="__SERVER__"
command -v node >/dev/null 2>&1 || { echo "Node.js 22.13 or newer is required: https://nodejs.org" >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || { echo "Node.js 22.13 or newer is required (found $(node --version))" >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM
fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; else wget -q "$1" -O "$2"; fi; }
fetch "$SERVER/agent/manifest.json" "$TMP/manifest.json"
fetch "$SERVER/agent/agent.mjs" "$TMP/agent.mjs"
# the download must match the SHA-256 the server publishes
node -e '
const fs = require("fs"), crypto = require("crypto");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const h = crypto.createHash("sha256").update(fs.readFileSync(process.argv[2])).digest("hex");
if (h !== m.sha256) { console.error("Checksum mismatch: expected " + m.sha256 + ", got " + h); process.exit(1); }
' "$TMP/manifest.json" "$TMP/agent.mjs"
node "$TMP/agent.mjs" install --server "$SERVER" "$@"
