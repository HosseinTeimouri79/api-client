# API Client Local Agent installer for Windows (no administrator rights needed; installed for the current user).
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm __SERVER__/agent/install.ps1 | iex"
$ErrorActionPreference = 'Stop'
$Server = '__SERVER__'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.13 or newer is required: https://nodejs.org' }
& node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if ($LASTEXITCODE -ne 0) { throw "Node.js 22.13 or newer is required (found $(node --version))" }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('api-client-agent-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $manifest = Invoke-RestMethod "$Server/agent/manifest.json"
  $file = Join-Path $tmp 'agent.mjs'
  Invoke-WebRequest "$Server/agent/agent.mjs" -OutFile $file -UseBasicParsing
  # the download must match the SHA-256 the server publishes
  $hash = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $manifest.sha256) { throw "Checksum mismatch: expected $($manifest.sha256), got $hash" }
  & node $file install --server $Server @args
  if ($LASTEXITCODE -ne 0) { throw 'Installation failed' }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
