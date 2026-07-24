#!/usr/bin/env bash
set -euo pipefail

RYOKO_USER="${RYOKO_USER:-ryoko}"
SLACK_ALLOW_USER_ID="${SLACK_ALLOW_USER_ID:?Set SLACK_ALLOW_USER_ID}"
ENVIRONMENT_FILE="${ENVIRONMENT_FILE:-/home/$RYOKO_USER/.config/openryoko/environment}"
HOME_DIR="/home/$RYOKO_USER"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo --preserve-env=SLACK_ALLOW_USER_ID,ENVIRONMENT_FILE $0" >&2
  exit 1
fi
if [[ ! -s "$ENVIRONMENT_FILE" ]]; then
  echo "Missing protected environment file: $ENVIRONMENT_FILE" >&2
  exit 1
fi
if [[ "$(stat -c '%a' "$ENVIRONMENT_FILE")" != "600" ]]; then
  echo "Environment file must have mode 600" >&2
  exit 1
fi

node_bin="$(
  sudo -u "$RYOKO_USER" -H bash -lc \
    'source "$HOME/.nvm/nvm.sh"; dirname "$(command -v node)"'
)"
real_claude="$node_bin/claude"
real_ryoko="$node_bin/ryoko"
rendered_file="$(mktemp)"
trap 'rm -f "$rendered_file"' EXIT

install -d -o "$RYOKO_USER" -g "$RYOKO_USER" -m 750 "$HOME_DIR/bin"
sed \
  -e "s|@ENVIRONMENT_FILE@|$ENVIRONMENT_FILE|g" \
  -e "s|@CLAUDE_BINARY@|$real_claude|g" \
  "$(dirname "$0")/templates/claude-wrapper.sh" >"$rendered_file"
install -o "$RYOKO_USER" -g "$RYOKO_USER" -m 750 \
  "$rendered_file" "$HOME_DIR/bin/claude"

sudo -u "$RYOKO_USER" -H bash -lc "
  set -euo pipefail
  source \"\$HOME/.nvm/nvm.sh\"
  [[ -f \"\$HOME/.ryoko/config.yaml\" ]] || ryoko setup
  ryoko config interactive on
  tmp=\$(mktemp)
  yq -y --arg uid '$SLACK_ALLOW_USER_ID' '
    .gateway.host = \"127.0.0.1\" |
    .connectors.slack.allowFrom = [\$uid] |
    .connectors.slack.respondTo.im = \"never\" |
    .connectors.slack.respondTo.mpim = \"never\" |
    .connectors.slack.respondTo.channel = \"mention\" |
    .connectors.slack.respondTo.engagedThreads = true
  ' \"\$HOME/.ryoko/config.yaml\" > \"\$tmp\"
  install -m 600 \"\$tmp\" \"\$HOME/.ryoko/config.yaml\"
  rm -f \"\$tmp\"
"

sed \
  -e "s|@RYOKO_USER@|$RYOKO_USER|g" \
  -e "s|@HOME_DIR@|$HOME_DIR|g" \
  -e "s|@NODE_BIN@|$node_bin|g" \
  -e "s|@RYOKO_BINARY@|$real_ryoko|g" \
  "$(dirname "$0")/templates/openryoko.service" >"$rendered_file"
install -o root -g root -m 644 "$rendered_file" \
  /etc/systemd/system/openryoko.service

install -d -m 755 /etc/systemd/system/openryoko.service.d
sed \
  -e "s|@ENVIRONMENT_FILE@|$ENVIRONMENT_FILE|g" \
  -e "s|@NODE_BIN@|$node_bin|g" \
  -e "s|@HOME_DIR@|$HOME_DIR|g" \
  -e "s|@CLAUDE_BINARY@|$real_claude|g" \
  "$(dirname "$0")/templates/environment.conf" >"$rendered_file"
install -o root -g root -m 644 "$rendered_file" \
  /etc/systemd/system/openryoko.service.d/environment.conf

systemctl daemon-reload
systemctl enable --now openryoko.service
systemctl restart openryoko.service
curl --fail --silent --show-error http://127.0.0.1:7777/ >/dev/null

echo "OpenRyoko is active on 127.0.0.1:7777."
