#!/usr/bin/env bash
# Updates only the custom panel binary and AimiliVPN integration files.
set -Eeuo pipefail

REPO="Newton-johnston/x-ui-vpngate"
INSTALL_DIR="/opt/3x-ui-vpngate"
RELEASE_URL="https://github.com/${REPO}/releases/latest/download/3x-ui-vpngate-linux-amd64.tar.gz"

[[ "${EUID}" -eq 0 ]] || { echo "Please run as root."; exit 1; }
archive="$(mktemp /tmp/3x-ui-vpngate.XXXXXX.tar.gz)"
trap 'rm -f "${archive}"' EXIT
curl --fail --location --retry 3 "${RELEASE_URL}" -o "${archive}"
install -d -m 0755 "${INSTALL_DIR}"
tar -xzf "${archive}" -C "${INSTALL_DIR}"
install -m 0755 "${INSTALL_DIR}/x-ui" /usr/local/x-ui/x-ui
install -m 0644 "${INSTALL_DIR}/deploy/aimili-vpngate.service" /etc/systemd/system/aimili-vpngate.service
systemctl daemon-reload
systemctl enable --now aimili-vpngate
systemctl restart x-ui
echo "3x-ui-vpngate updated successfully."
