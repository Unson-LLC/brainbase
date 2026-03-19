#!/usr/bin/env bash
# brainbase セットアップスクリプト
# 新メンバーは clone → npm install → ./scripts/setup.sh の3ステップで完了
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAINBASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== brainbase セットアップ ==="
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

# ────────────── ~/.brainbase/ ディレクトリ作成 ──────────────
mkdir -p ~/.brainbase
echo "[OK] ~/.brainbase/ ディレクトリ作成"

# ────────────── var/ ディレクトリ作成 ──────────────
mkdir -p "$BRAINBASE_VAR_DIR"
echo "[OK] var/ ディレクトリ作成"

# ────────────── .env ファイル生成 ──────────────
ENV_FILE="$BRAINBASE_DIR/.env"
cat > "$ENV_FILE" << ENVEOF
# brainbase 環境変数（自動生成 by scripts/setup.sh）
# このファイルは .gitignore に含まれています

# DB接続（SSHトンネル経由: ssh -L 5432:localhost:5432 lightsail）
INFO_SSOT_DATABASE_URL=$INFO_SSOT_DATABASE_URL

# 認証
BRAINBASE_JWT_SECRET=$BRAINBASE_JWT_SECRET
SLACK_CLIENT_ID=$SLACK_CLIENT_ID
SLACK_CLIENT_SECRET=$SLACK_CLIENT_SECRET
SLACK_REDIRECT_URI=$SLACK_REDIRECT_URI
SLACK_AUTH_MODE=$SLACK_AUTH_MODE
SLACK_AUTH_USER_SCOPES=$SLACK_AUTH_USER_SCOPES

# サーバー設定
PORT=$PORT
NODE_ENV=$NODE_ENV
ALLOW_INSECURE_SSOT_HEADERS=$ALLOW_INSECURE_SSOT_HEADERS

# パス
BRAINBASE_ROOT=$BRAINBASE_ROOT
BRAINBASE_VAR_DIR=$BRAINBASE_VAR_DIR
WORKSPACE_ROOT=$WORKSPACE_ROOT
PROJECTS_ROOT=$PROJECTS_ROOT
ENVEOF
echo "[OK] .env 生成: $ENV_FILE"

# ────────────── macOS: launchd plist 生成 ──────────────
if [[ "$(uname)" == "Darwin" ]]; then
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST_FILE="$PLIST_DIR/com.brainbase.ui.plist"
    LOG_DIR="$HOME/Library/Logs"

    mkdir -p "$PLIST_DIR"

    # npm のパスを検出
    NPM_PATH="$(which npm 2>/dev/null || echo "/usr/local/bin/npm")"

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
    echo "[OK] launchd plist 生成: $PLIST_FILE"
    echo ""
    echo "サーバー起動:"
    echo "  launchctl load $PLIST_FILE"
    echo ""
    echo "再起動:"
    echo "  launchctl kickstart -k gui/\$(id -u)/com.brainbase.ui"
else
    echo ""
    echo "macOS以外の場合は手動でサーバーを起動してください:"
    echo "  source .env && node server.js"
fi

echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "次のステップ:"
echo "  1. SSHトンネル開始: ssh -fNL 5432:localhost:5432 <lightsailホスト>"
echo "  2. サーバー起動: launchctl load ~/Library/LaunchAgents/com.brainbase.ui.plist"
echo "  3. ブラウザで http://localhost:31013 を開く"
echo "  4. 「Login with Slack」でログイン"
echo ""
echo "※ SSHトンネルの接続先は管理者に確認してください"
