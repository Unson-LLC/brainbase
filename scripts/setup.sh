#!/usr/bin/env bash
# brainbase ワンコマンドセットアップ
#
# 使い方:
#   git clone git@github.com:Unson-LLC/brainbase-unson.git && brainbase-unson/scripts/setup.sh
#
set -euo pipefail

# ────────────── clone済みかどうかで分岐 ──────────────
if [[ -f "$(dirname "$0")/../server.js" ]]; then
    # スクリプトがリポジトリ内から実行されている
    BRAINBASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
else
    # どこかから直接実行されている → clone する
    INSTALL_DIR="${1:-$HOME/brainbase}"
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        echo "既存のインストールを検出: $INSTALL_DIR"
        echo "最新に更新中..."
        cd "$INSTALL_DIR" && git pull
        BRAINBASE_DIR="$INSTALL_DIR"
    else
        echo "brainbase をクローン中..."
        git clone git@github.com:Unson-LLC/brainbase-unson.git "$INSTALL_DIR"
        BRAINBASE_DIR="$INSTALL_DIR"
    fi
fi

cd "$BRAINBASE_DIR"

echo ""
echo "=== brainbase セットアップ ==="
echo ""

# ────────────── npm install ──────────────
echo "依存パッケージをインストール中..."
npm install --silent
echo "[OK] npm install 完了"

# ────────────── MCP Server 依存インストール ──────────────
echo "MCP Serverの依存パッケージをインストール中..."
for mcp_dir in "$BRAINBASE_DIR"/mcp/*/; do
    if [ -f "$mcp_dir/package.json" ]; then
        (cd "$mcp_dir" && npm install --silent 2>/dev/null)
        echo "  [OK] $(basename "$mcp_dir")"
    fi
done
echo "[OK] MCP Server 依存インストール完了"

# ────────────── CLIツール（gogcli） ──────────────
if command -v gog &> /dev/null; then
    echo "[OK] gogcli インストール済み ($(gog --version 2>&1 | head -1))"
elif command -v brew &> /dev/null; then
    echo "gogcli をインストール中..."
    brew install gogcli --quiet
    echo "[OK] gogcli インストール完了"
else
    echo "[!] gogcli 未インストール（brew install gogcli で手動インストールしてください）"
fi
echo ""

# ────────────── 共通環境変数（全メンバー同じ値） ──────────────
BRAINBASE_JWT_SECRET="91fCWNFaMqZ56B4qSN6fUn0s880niCw5PX2lraEtZD4="
SLACK_CLIENT_ID="7700200993749.9126720830805"
SLACK_CLIENT_SECRET="3229f6d294193088f208c10efbb014c4"
SLACK_REDIRECT_URI="https://bb.brain-base.work/api/auth/slack/callback"
SLACK_AUTH_MODE="oauth"
SLACK_AUTH_USER_SCOPES="chat:write,files:write"
PORT="31013"
NODE_ENV="development"
ALLOW_INSECURE_SSOT_HEADERS="true"

# ────────────── パス自動検出 ──────────────
WORKSPACE_ROOT="$(cd "$BRAINBASE_DIR/.." && pwd)"
BRAINBASE_ROOT="$WORKSPACE_ROOT"
BRAINBASE_VAR_DIR="$WORKSPACE_ROOT/var"
PROJECTS_ROOT="$WORKSPACE_ROOT/projects"

# DB接続（ローカルSSHトンネル経由）
INFO_SSOT_DATABASE_URL="postgres://localhost/brainbase_ssot"

# ────────────── ディレクトリ作成 ──────────────
mkdir -p ~/.brainbase "$BRAINBASE_VAR_DIR"
echo "[OK] ディレクトリ作成"

# ────────────── .env ファイル生成 ──────────────
cat > "$BRAINBASE_DIR/.env" << ENVEOF
# brainbase 環境変数（自動生成 by scripts/setup.sh）
# このファイルは .gitignore に含まれています

INFO_SSOT_DATABASE_URL=$INFO_SSOT_DATABASE_URL
BRAINBASE_JWT_SECRET=$BRAINBASE_JWT_SECRET
SLACK_CLIENT_ID=$SLACK_CLIENT_ID
SLACK_CLIENT_SECRET=$SLACK_CLIENT_SECRET
SLACK_REDIRECT_URI=$SLACK_REDIRECT_URI
SLACK_AUTH_MODE=$SLACK_AUTH_MODE
SLACK_AUTH_USER_SCOPES=$SLACK_AUTH_USER_SCOPES
PORT=$PORT
NODE_ENV=$NODE_ENV
ALLOW_INSECURE_SSOT_HEADERS=$ALLOW_INSECURE_SSOT_HEADERS
BRAINBASE_ROOT=$BRAINBASE_ROOT
BRAINBASE_VAR_DIR=$BRAINBASE_VAR_DIR
WORKSPACE_ROOT=$WORKSPACE_ROOT
PROJECTS_ROOT=$PROJECTS_ROOT
ENVEOF
echo "[OK] .env 生成"

# ────────────── macOS: launchd plist 生成 + サーバー起動 ──────────────
if [[ "$(uname)" == "Darwin" ]]; then
    PLIST_FILE="$HOME/Library/LaunchAgents/com.brainbase.ui.plist"
    LOG_DIR="$HOME/Library/Logs"
    NPM_PATH="$(which npm 2>/dev/null || echo "/usr/local/bin/npm")"

    mkdir -p "$HOME/Library/LaunchAgents"

    cat > "$PLIST_FILE" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>BRAINBASE_ROOT</key>
		<string>$BRAINBASE_ROOT</string>
		<key>BRAINBASE_VAR_DIR</key>
		<string>$BRAINBASE_VAR_DIR</string>
		<key>WORKSPACE_ROOT</key>
		<string>$WORKSPACE_ROOT</string>
		<key>NODE_ENV</key>
		<string>$NODE_ENV</string>
		<key>PATH</key>
		<string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string>
		<key>PORT</key>
		<string>$PORT</string>
		<key>PROJECTS_ROOT</key>
		<string>$PROJECTS_ROOT</string>
		<key>BRAINBASE_JWT_SECRET</key>
		<string>$BRAINBASE_JWT_SECRET</string>
		<key>SLACK_CLIENT_ID</key>
		<string>$SLACK_CLIENT_ID</string>
		<key>SLACK_CLIENT_SECRET</key>
		<string>$SLACK_CLIENT_SECRET</string>
		<key>SLACK_REDIRECT_URI</key>
		<string>$SLACK_REDIRECT_URI</string>
		<key>SLACK_AUTH_MODE</key>
		<string>$SLACK_AUTH_MODE</string>
		<key>INFO_SSOT_DATABASE_URL</key>
		<string>$INFO_SSOT_DATABASE_URL</string>
		<key>ALLOW_INSECURE_SSOT_HEADERS</key>
		<string>$ALLOW_INSECURE_SSOT_HEADERS</string>
		<key>SLACK_AUTH_SCOPES</key>
		<string></string>
		<key>SLACK_AUTH_USER_SCOPES</key>
		<string>$SLACK_AUTH_USER_SCOPES</string>
	</dict>
	<key>KeepAlive</key>
	<true/>
	<key>Label</key>
	<string>com.brainbase.ui</string>
	<key>ProgramArguments</key>
	<array>
		<string>$NPM_PATH</string>
		<string>run</string>
		<string>start</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>$LOG_DIR/brainbase-ui.error.log</string>
	<key>StandardOutPath</key>
	<string>$LOG_DIR/brainbase-ui.log</string>
	<key>ThrottleInterval</key>
	<integer>10</integer>
	<key>WorkingDirectory</key>
	<string>$BRAINBASE_DIR</string>
</dict>
</plist>
PLISTEOF
    echo "[OK] launchd plist 生成"

    # サーバー起動
    launchctl bootout gui/$(id -u)/com.brainbase.ui 2>/dev/null || true
    launchctl load "$PLIST_FILE"
    echo "[OK] サーバー起動中..."
    sleep 3

    # ヘルスチェック
    if curl -sf http://localhost:31013/api/health > /dev/null 2>&1; then
        echo "[OK] サーバー起動確認"
    else
        echo "[!] サーバー起動中... 数秒後に http://localhost:31013 を確認してください"
    fi
else
    echo ""
    echo "手動でサーバーを起動してください:"
    echo "  source .env && node server.js"
fi

echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "http://localhost:31013 を開いて「Login with Slack」でログイン"
echo ""
echo "※ DB接続にはSSHトンネルが必要です:"
echo "  ssh -fNL 5432:localhost:5432 <lightsailホスト>"
