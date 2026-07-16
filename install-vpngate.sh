#!/usr/bin/env bash
# Installs the VPS-side prerequisites used by the AimiliVPN + 3x-ui adapter.
# The panel binary itself is provided by a GitHub Release build.
set -Eeuo pipefail

REPO="Newton-johnston/3x-ui-vpngate"
INSTALL_DIR="/opt/3x-ui-vpngate"
RELEASE_URL="https://github.com/${REPO}/releases/latest/download/3x-ui-vpngate-linux-amd64.tar.gz"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root."
  exit 1
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "Only x86_64 Linux is supported by the current release package."
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl openvpn python3
install -d -m 0755 "${INSTALL_DIR}"
archive="$(mktemp /tmp/3x-ui-vpngate.XXXXXX.tar.gz)"
trap 'rm -f "${archive}"' EXIT
curl --fail --location --retry 3 "${RELEASE_URL}" -o "${archive}"
tar -xzf "${archive}" -C "${INSTALL_DIR}"

# Install the upstream 3x-ui runtime (service unit, Xray core and defaults),
# then replace only the panel binary with this release's VPNGate-aware build.
if [[ -n "${XUI_DOMAIN:-}" ]]; then
  XUI_DOMAIN="${XUI_DOMAIN}" bash <(curl -fsSL https://raw.githubusercontent.com/Teminuosi/3x-ui/main/install.sh)
else
  XUI_AUTO=1 bash <(curl -fsSL https://raw.githubusercontent.com/Teminuosi/3x-ui/main/install.sh)
fi
install -m 0755 "${INSTALL_DIR}/x-ui" /usr/local/x-ui/x-ui
install -m 0644 "${INSTALL_DIR}/deploy/aimili-vpngate.service" /etc/systemd/system/aimili-vpngate.service
systemctl daemon-reload
systemctl enable --now aimili-vpngate

# The upstream installer preserves an existing panel database.  Make the
# VPNGate outlet available immediately in both fresh and upgraded installs,
# and discard the broken legacy Aimili Shadowsocks outlet (it has no password,
# which prevents Xray from starting).
systemctl stop x-ui || true
DB_PATH="${XUI_DB_FOLDER:-/etc/x-ui}/x-ui.db"
if [[ -f "${DB_PATH}" ]]; then
  cp -a "${DB_PATH}" "${DB_PATH}.before-vpngate-$(date +%Y%m%d%H%M%S).bak"
  python3 - "${DB_PATH}" <<'PY'
import json
import sqlite3
import sys

db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
try:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", ("xrayTemplateConfig",)).fetchone()
    if row is None:
        print("xrayTemplateConfig was not found; keeping the panel default configuration.")
        raise SystemExit(0)

    config = json.loads(row[0])
    outbounds = config.setdefault("outbounds", [])

    # Older experimental builds created this invalid Shadowsocks outbound.
    # It has no password and makes every Xray restart fail.
    outbounds[:] = [
        outbound for outbound in outbounds
        if not (
            isinstance(outbound, dict)
            and outbound.get("tag") in {"alimili", "aimili"}
            and outbound.get("protocol") == "shadowsocks"
        )
    ]

    vpngate = {
        "tag": "vpngate",
        "protocol": "socks",
        "settings": {"servers": [{"address": "127.0.0.1", "port": 7928}]},
    }
    for index, outbound in enumerate(outbounds):
        if isinstance(outbound, dict) and outbound.get("tag") == "vpngate":
            outbounds[index] = vpngate
            break
    else:
        outbounds.append(vpngate)

    conn.execute(
        "UPDATE settings SET value = ? WHERE key = ?",
        (json.dumps(config, separators=(",", ":")), "xrayTemplateConfig"),
    )
    conn.commit()
    print("Configured the vpngate SOCKS outbound at 127.0.0.1:7928.")
finally:
    conn.close()
PY
fi
systemctl restart x-ui

systemctl is-active --quiet x-ui
systemctl is-active --quiet aimili-vpngate

echo "AimiliVPN is running with its proxy bound to 127.0.0.1:7928."
echo "3x-ui is installed with the vpngate outbound configured."
