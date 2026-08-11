#!/usr/bin/env bash
set -euo pipefail

RYOKO_USER="${RYOKO_USER:-ryoko}"
NODE_VERSION="${NODE_VERSION:-22}"
CLAUDE_MIN_VERSION="${CLAUDE_MIN_VERSION:-2.1.139}"
OPENRYOKO_REPOSITORY="${OPENRYOKO_REPOSITORY:-https://github.com/Unson-LLC/OpenRyoko.git}"
OPENRYOKO_REF="${OPENRYOKO_REF:-ca34b7e3e3dea4b92fc8f419b0884d59bd27da5e}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

if ! id "$RYOKO_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$RYOKO_USER"
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y curl git jq yq build-essential

sudo -u "$RYOKO_USER" -H bash -lc "
  set -euo pipefail
  if [[ ! -s \"\$HOME/.nvm/nvm.sh\" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  source \"\$HOME/.nvm/nvm.sh\"
  nvm install \"$NODE_VERSION\"
  nvm alias default \"$NODE_VERSION\"
  npm install -g @anthropic-ai/claude-code

  install_root=\"\$HOME/src\"
  repo_dir=\"\$install_root/OpenRyoko\"
  mkdir -p \"\$install_root\"
  if [[ ! -d \"\$repo_dir/.git\" ]]; then
    git clone \"$OPENRYOKO_REPOSITORY\" \"\$repo_dir\"
  fi
  git -C \"\$repo_dir\" fetch --prune origin
  git -C \"\$repo_dir\" checkout --detach \"$OPENRYOKO_REF\"
  corepack enable
  cd \"\$repo_dir\"
  pnpm install --frozen-lockfile
  pnpm build
  node packages/jimmy/dist/bin/jimmy.js --version
  test \"\$(git rev-parse HEAD)\" = \"$OPENRYOKO_REF\"
  claude --version
"

installed_claude_version="$(
  sudo -u "$RYOKO_USER" -H bash -lc \
    'source "$HOME/.nvm/nvm.sh"; claude --version' | awk '{print $1}'
)"
if ! printf '%s\n%s\n' "$CLAUDE_MIN_VERSION" "$installed_claude_version" |
  sort -V -C; then
  echo "Claude Code $installed_claude_version is older than $CLAUDE_MIN_VERSION" >&2
  exit 1
fi

install -d -o "$RYOKO_USER" -g "$RYOKO_USER" -m 700 \
  "/home/$RYOKO_USER/.config/openryoko" \
  "/home/$RYOKO_USER/bin"

echo "Base packages installed. Continue with configure-runtime.sh after provisioning secrets."
