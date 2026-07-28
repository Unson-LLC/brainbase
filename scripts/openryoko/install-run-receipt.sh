#!/usr/bin/env bash
set -euo pipefail

RYOKO_USER="${RYOKO_USER:-ryoko}"
ENVIRONMENT_FILE="${ENVIRONMENT_FILE:-/home/$RYOKO_USER/.config/openryoko/run-receipt.env}"
HOME_DIR="/home/$RYOKO_USER"
INSTALL_DIR="$HOME_DIR/lib/openryoko-run-receipt"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo --preserve-env=ENVIRONMENT_FILE $0" >&2
  exit 1
fi
if [[ ! -s "$ENVIRONMENT_FILE" ]]; then
  echo "Missing protected run receipt environment file: $ENVIRONMENT_FILE" >&2
  exit 1
fi
if [[ "$(stat -c '%a' "$ENVIRONMENT_FILE")" != "600" ]]; then
  echo "Run receipt environment file must have mode 600" >&2
  exit 1
fi
for required_name in \
  BRAINBASE_PROJECT_ID \
  BRAINBASE_RUN_RECEIPT_INGEST_URL \
  BRAINBASE_RUN_RECEIPT_SERVICE_TOKEN; do
  if ! grep -q "^${required_name}=" "$ENVIRONMENT_FILE"; then
    echo "Run receipt environment file is missing $required_name" >&2
    exit 1
  fi
done

node_bin="$(
  sudo -u "$RYOKO_USER" -H bash -lc \
    'source "$HOME/.nvm/nvm.sh"; dirname "$(command -v node)"'
)"

install -d -o "$RYOKO_USER" -g "$RYOKO_USER" -m 750 \
  "$INSTALL_DIR" \
  "$HOME_DIR/.local/state/openryoko-run-receipt" \
  "$HOME_DIR/.local/state/openryoko-run-receipt/outbox" \
  "$HOME_DIR/.local/state/openryoko-run-receipt/dead-letter" \
  "$HOME_DIR/.local/state/openryoko-run-receipt/resolved"
install -o "$RYOKO_USER" -g "$RYOKO_USER" -m 640 \
  "$REPOSITORY_ROOT/scripts/run-receipt/reporter-core.mjs" \
  "$REPOSITORY_ROOT/scripts/run-receipt/openryoko-reporter.mjs" \
  "$INSTALL_DIR/"
install -o "$RYOKO_USER" -g "$RYOKO_USER" -m 750 \
  "$REPOSITORY_ROOT/scripts/openryoko/check-pilot-health.sh" \
  "$HOME_DIR/bin/openryoko-pilot-health"

rendered_file="$(mktemp)"
trap 'rm -f "$rendered_file"' EXIT
for unit in \
  openryoko-run-receipt.service \
  openryoko-run-receipt.timer \
  openryoko-pilot-health.service \
  openryoko-pilot-health.timer; do
  sed \
    -e "s|@RYOKO_USER@|$RYOKO_USER|g" \
    -e "s|@HOME_DIR@|$HOME_DIR|g" \
    -e "s|@NODE_BIN@|$node_bin|g" \
    -e "s|@ENVIRONMENT_FILE@|$ENVIRONMENT_FILE|g" \
    "$SCRIPT_DIR/templates/$unit" >"$rendered_file"
  install -o root -g root -m 644 "$rendered_file" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable --now openryoko-run-receipt.timer
systemctl start openryoko-run-receipt.service
systemctl is-active --quiet openryoko-run-receipt.timer
systemctl enable --now openryoko-pilot-health.timer

echo "OpenRyoko run receipt collector and pilot health timer are active."
