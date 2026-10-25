#!/usr/bin/env bash
# Install or update dsh-tg-bridge from the npm registry (macOS / Linux).
#
#   DSH_TG_TOKEN=123456:AA... DSH_TG_USER=123456789 bash install.sh
#
# Optional: --voice, --no-autostart. Environment: DSH_TG_HOME (install dir),
# DSH_TG_PACKAGE (npm package, default dsh-tg-bridge).
set -euo pipefail

PKG="${DSH_TG_PACKAGE:-dsh-tg-bridge}"
DEST="${DSH_TG_HOME:-$HOME/.dsh/tg-bridge}"
SERVICE="dsh-tg-bridge"
VOICE=""

for arg in "$@"; do
  case "$arg" in
    --voice) VOICE="--voice" ;;
    --no-autostart) NO_AUTOSTART=1 ;;
    *) ;;
  esac
done

command -v node >/dev/null || { echo "node >= 20 is required"; exit 1; }
command -v npm >/dev/null || { echo "npm is required"; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || { echo "node >= 20 is required (found $(node -v))"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "downloading $PKG@latest"
npm pack "$PKG@latest" --pack-destination "$TMP" >/dev/null
TARBALL="$(find "$TMP" -maxdepth 1 -name '*.tgz' | head -n 1)"
[ -n "$TARBALL" ] || { echo "npm pack produced no tarball"; exit 1; }
tar -xzf "$TARBALL" -C "$TMP"

echo "installing into $DEST"
mkdir -p "$DEST"
# config.json, state.json and pending/ are not part of the package, so an
# update keeps them while every code file is replaced.
cp -R "$TMP/package/." "$DEST/"

cd "$DEST"

# Credentials first: config.json and the token together are the whole setup.
if [ -n "${DSH_TG_TOKEN:-}" ] && [ -n "${DSH_TG_USER:-}" ]; then
  node cli.mjs init --token "$DSH_TG_TOKEN" --user "$DSH_TG_USER" ${VOICE:+"$VOICE"}
elif [ ! -f config.json ]; then
  cp config.example.json config.json
  echo "created config.json - set allowedUserIds and cwd, or rerun with DSH_TG_TOKEN/DSH_TG_USER"
fi

# Autostart keeps the bot alive across reboots and crashes. It is skipped when the
# person only wants to look around (--no-autostart).
if [ -z "${NO_AUTOSTART:-}" ]; then
  NODE_BIN="$(command -v node)"
  case "$(uname -s)" in
    Darwin)
      PLIST="$HOME/Library/LaunchAgents/com.dsh.tg-bridge.plist"
      mkdir -p "$(dirname "$PLIST")"
      cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.dsh.tg-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--dns-result-order=ipv4first</string>
    <string>$DEST/bridge.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DEST</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DEST/bridge.out.log</string>
  <key>StandardErrorPath</key><string>$DEST/bridge.err.log</string>
</dict>
</plist>
PLIST_EOF
      launchctl unload "$PLIST" 2>/dev/null || true
      launchctl load "$PLIST"
      echo "autostart: launchd $PLIST"
      ;;
    Linux)
      UNIT_DIR="$HOME/.config/systemd/user"
      mkdir -p "$UNIT_DIR"
      cat > "$UNIT_DIR/$SERVICE.service" <<UNIT_EOF
[Unit]
Description=DSH Telegram bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$DEST
ExecStart=$NODE_BIN --dns-result-order=ipv4first $DEST/bridge.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
UNIT_EOF
      systemctl --user daemon-reload || true
      systemctl --user enable --now "$SERVICE" || echo "systemd --user unavailable - start manually: node $DEST/bridge.mjs"
      echo "autostart: systemd --user $SERVICE"
      ;;
    *)
      echo "autostart: $(uname -s) is not supported - start manually: node $DEST/bridge.mjs"
      ;;
  esac
fi

echo
node cli.mjs check || true
echo
echo "Next:"
echo "  in Telegram: /doctor, /help, /plugins, /cd <project>"
echo "  logs:        tail -f $DEST/bridge.out.log"
