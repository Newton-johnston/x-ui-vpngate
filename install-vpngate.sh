#!/usr/bin/env bash
# Installs the VPS-side prerequisites used by the AimiliVPN + 3x-ui adapter.
# The panel binary itself is provided by a GitHub Release build.
set -Eeuo pipefail

REPO="p2pzcn-rgb/3x-ui-vpngate"
INSTALL_DIR="/opt/3x-ui-vpngate"
RELEASE_URL="https://github.com/${REPO}/releases/latest/download/3x-ui-vpngate-linux-amd64.tar.gz"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root."
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl openvpn python3
install -d -m 0755 "${INSTALL_DIR}"
curl -fL "${RELEASE_URL}" -o /tmp/3x-ui-vpngate.tar.gz
tar -xzf /tmp/3x-ui-vpngate.tar.gz -C "${INSTALL_DIR}"

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
systemctl restart x-ui

echo "AimiliVPN is running with its proxy bound to 127.0.0.1:7928."
echo "3x-ui is installed. Use the VPNGate card in Xray settings after logging in."
