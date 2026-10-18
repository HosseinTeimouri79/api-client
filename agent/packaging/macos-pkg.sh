#!/bin/sh
# Builds a signed, notarized macOS installer package (.pkg) from the standalone agent that `npm run build:installers`
# made. Run on a Mac with Xcode command line tools:
#
#   DEVELOPER_ID_APP="Developer ID Application: Example Ltd (TEAMID)" \
#   DEVELOPER_ID_INSTALLER="Developer ID Installer: Example Ltd (TEAMID)" \
#   NOTARY_PROFILE=notary   agent/packaging/macos-pkg.sh arm64      # or x64
#
# (NOTARY_PROFILE: a keychain profile from `xcrun notarytool store-credentials`.) Without the variables the package is
# built unsigned, which is enough for testing. The package installs /usr/local/lib/api-client-agent/api-client-agent,
# links /usr/local/bin/api-client-agent and opens the guided setup in Terminal for the user who installed it.
set -eu
ARCH=${1:-arm64}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${AGENT_INSTALLERS_DIR:-$ROOT/build/installers}
VERSION=$(node -p "require('$ROOT/package.json').version")
ZIP="$OUT/api-client-agent-$VERSION-macos-$ARCH.zip"
[ "$(uname)" = Darwin ] || { echo "Run this on macOS (pkgbuild, codesign and notarytool are macOS tools)" >&2; exit 1; }
[ -f "$ZIP" ] || { echo "Missing $ZIP: run npm run build:installers first" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/root/usr/local/lib/api-client-agent" "$WORK/scripts"
unzip -q "$ZIP" -d "$WORK/unzip"
BIN="$WORK/root/usr/local/lib/api-client-agent/api-client-agent"
cp "$WORK/unzip/api-client-agent" "$BIN"
chmod 755 "$BIN"

if [ -n "${DEVELOPER_ID_APP:-}" ]; then
  # notarization needs the hardened runtime; Node.js (V8) needs JIT memory under it
  cat > "$WORK/entitlements.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
PLIST
  codesign --force --timestamp --options runtime --entitlements "$WORK/entitlements.plist" --sign "$DEVELOPER_ID_APP" "$BIN"
fi

cat > "$WORK/scripts/postinstall" <<'SCRIPT'
#!/bin/sh
ln -sf /usr/local/lib/api-client-agent/api-client-agent /usr/local/bin/api-client-agent
# the agent runs per user: open the guided setup in Terminal for whoever is logged in at the screen
USER_NAME=$(stat -f %Su /dev/console 2>/dev/null || true)
if [ -n "$USER_NAME" ] && [ "$USER_NAME" != "root" ]; then
  sudo -u "$USER_NAME" open -a Terminal /usr/local/lib/api-client-agent/api-client-agent || true
fi
exit 0
SCRIPT
chmod 755 "$WORK/scripts/postinstall"

PKG="$OUT/api-client-agent-$VERSION-macos-$ARCH.pkg"
if [ -n "${DEVELOPER_ID_INSTALLER:-}" ]; then
  pkgbuild --root "$WORK/root" --scripts "$WORK/scripts" --identifier com.apiclient.agent --version "$VERSION" --install-location / --sign "$DEVELOPER_ID_INSTALLER" "$PKG"
else
  pkgbuild --root "$WORK/root" --scripts "$WORK/scripts" --identifier com.apiclient.agent --version "$VERSION" --install-location / "$PKG"
fi
if [ -n "${NOTARY_PROFILE:-}" ]; then
  xcrun notarytool submit "$PKG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$PKG"
fi
# list it next to the other installers (the server offers what index.json names)
node -e '
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const [dir, file, arch] = process.argv.slice(1), idx = path.join(dir, "index.json");
const index = JSON.parse(fs.readFileSync(idx, "utf8")), buf = fs.readFileSync(path.join(dir, file));
index.files = index.files.filter((f) => f.file !== file);
index.files.push({ platform: "darwin", arch, kind: "pkg", file, size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), installer: "pkg" });
fs.writeFileSync(idx, JSON.stringify(index, null, 2) + "\n");
' "$OUT" "$(basename "$PKG")" "$ARCH"
echo "Built $PKG"
