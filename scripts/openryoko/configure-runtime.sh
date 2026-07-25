#!/usr/bin/env bash
set -euo pipefail

RYOKO_USER="${RYOKO_USER:-ryoko}"
SLACK_ALLOW_USER_ID="${SLACK_ALLOW_USER_ID:?Set SLACK_ALLOW_USER_ID}"
GATEWAY_ENVIRONMENT_FILE="${GATEWAY_ENVIRONMENT_FILE:-/home/$RYOKO_USER/.config/openryoko/gateway-environment}"
CLAUDE_ENVIRONMENT_FILE="${CLAUDE_ENVIRONMENT_FILE:-/home/$RYOKO_USER/.config/openryoko/claude-environment}"
HOME_DIR="/home/$RYOKO_USER"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo --preserve-env=SLACK_ALLOW_USER_ID,GATEWAY_ENVIRONMENT_FILE,CLAUDE_ENVIRONMENT_FILE $0" >&2
  exit 1
fi
for protected_file in "$GATEWAY_ENVIRONMENT_FILE" "$CLAUDE_ENVIRONMENT_FILE"; do
  if [[ ! -s "$protected_file" ]]; then
    echo "Missing protected environment file: $protected_file" >&2
    exit 1
  fi
  if [[ "$(stat -c '%a' "$protected_file")" != "600" ]]; then
    echo "Environment file must have mode 600: $protected_file" >&2
    exit 1
  fi
done
grep -q '^OPENRYOKO_SLACK_APP_TOKEN=' "$GATEWAY_ENVIRONMENT_FILE"
grep -q '^OPENRYOKO_SLACK_BOT_TOKEN=' "$GATEWAY_ENVIRONMENT_FILE"
grep -q '^CLAUDE_CODE_OAUTH_TOKEN=' "$CLAUDE_ENVIRONMENT_FILE"
if grep -q '^OPENRYOKO_SLACK_' "$CLAUDE_ENVIRONMENT_FILE"; then
  echo "Claude environment must not contain Slack credentials" >&2
  exit 1
fi

node_bin="$(
  sudo -u "$RYOKO_USER" -H bash -lc \
    'source "$HOME/.nvm/nvm.sh"; dirname "$(command -v node)"'
)"
real_claude="$node_bin/claude"
openryoko_root="$HOME_DIR/src/OpenRyoko"
openryoko_cli="$openryoko_root/packages/jimmy/dist/bin/jimmy.js"
real_ryoko="$HOME_DIR/bin/ryoko"
rendered_file="$(mktemp)"
trap 'rm -f "$rendered_file"' EXIT

install -d -o "$RYOKO_USER" -g "$RYOKO_USER" -m 750 "$HOME_DIR/bin"
if [[ ! -f "$openryoko_cli" ]]; then
  echo "Missing pinned OpenRyoko build: $openryoko_cli" >&2
  exit 1
fi
cat >"$rendered_file" <<EOF
#!/usr/bin/env bash
exec "$node_bin/node" "$openryoko_cli" "\$@"
EOF
install -o "$RYOKO_USER" -g "$RYOKO_USER" -m 750 \
  "$rendered_file" "$real_ryoko"

sed \
  -e "s|@ENVIRONMENT_FILE@|$CLAUDE_ENVIRONMENT_FILE|g" \
  -e "s|@CLAUDE_BINARY@|$real_claude|g" \
  "$(dirname "$0")/templates/claude-wrapper.sh" >"$rendered_file"
install -o "$RYOKO_USER" -g "$RYOKO_USER" -m 750 \
  "$rendered_file" "$HOME_DIR/bin/claude"

sudo -u "$RYOKO_USER" -H bash -lc "
  set -euo pipefail
  source \"\$HOME/.nvm/nvm.sh\"
  [[ -f \"\$HOME/.ryoko/config.yaml\" ]] || ryoko setup
  ryoko config interactive on
  cd \"$openryoko_root/packages/jimmy\"
  SLACK_ALLOW_USER_ID='$SLACK_ALLOW_USER_ID' node --input-type=module <<'NODE'
import fs from \"node:fs\";
import yaml from \"js-yaml\";

const configPath = process.env.HOME + \"/.ryoko/config.yaml\";
const config = yaml.load(fs.readFileSync(configPath, \"utf8\"));
config.gateway ??= {};
config.gateway.host = \"127.0.0.1\";
config.connectors ??= {};
config.connectors.slack ??= {};
delete config.connectors.slack.appToken;
delete config.connectors.slack.botToken;
config.connectors.slack.allowFrom = [process.env.SLACK_ALLOW_USER_ID];
config.connectors.slack.respondTo = {
  im: \"never\",
  mpim: \"never\",
  channel: \"mention\",
  engagedThreads: true,
};
config.engines ??= {};
config.engines.claude ??= {};
config.engines.claude.interactive = true;
config.engines.claude.interactivePermissionMode = \"plan\";
const tmp = configPath + \".tmp\";
fs.writeFileSync(tmp, yaml.dump(config, { lineWidth: 120 }), { mode: 0o600 });
fs.renameSync(tmp, configPath);
NODE
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
  -e "s|@ENVIRONMENT_FILE@|$GATEWAY_ENVIRONMENT_FILE|g" \
  -e "s|@NODE_BIN@|$node_bin|g" \
  -e "s|@HOME_DIR@|$HOME_DIR|g" \
  -e "s|@CLAUDE_BINARY@|$real_claude|g" \
  "$(dirname "$0")/templates/environment.conf" >"$rendered_file"
install -o root -g root -m 644 "$rendered_file" \
  /etc/systemd/system/openryoko.service.d/environment.conf

systemctl daemon-reload
systemctl enable --now openryoko.service
systemctl restart openryoko.service
for attempt in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:7777/ >/dev/null; then
    break
  fi
  if [[ "$attempt" -eq 20 ]]; then
    systemctl status openryoko.service --no-pager --lines=30 >&2
    exit 1
  fi
  sleep 1
done

echo "OpenRyoko is active on 127.0.0.1:7777."
