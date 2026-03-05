#!/bin/bash
set -e

# Dev Server for Worktree
# 本番環境のデータをコピーして、別ポートでテスト環境を起動

echo "🚀 Starting dev server for worktree..."

# 1. 空きポート検出（31014以降）
PORT=31014
while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
    echo "   Port $PORT is in use, trying next..."
    PORT=$((PORT + 1))
done
echo "✅ Found available port: $PORT"

# 2. 本番環境のデータパスを確認
if [ -z "$BRAINBASE_ROOT" ]; then
    echo "❌ Error: BRAINBASE_ROOT environment variable is not set"
    exit 1
fi

PROD_DATA_PATH="$BRAINBASE_ROOT"
TEST_DATA_PATH="/tmp/brainbase-test-$PORT"

echo "📋 Copying data from production to test environment..."
echo "   Source: $PROD_DATA_PATH"
echo "   Destination: $TEST_DATA_PATH"

# 3. テストデータディレクトリを作成
rm -rf "$TEST_DATA_PATH"
mkdir -p "$TEST_DATA_PATH"

# 4. 本番環境のデータをコピー
# セッション情報、タスク情報、スケジュール情報をコピー
if [ -d "$PROD_DATA_PATH/_sessions" ]; then
    cp -R "$PROD_DATA_PATH/_sessions" "$TEST_DATA_PATH/"
    echo "   ✅ Copied _sessions/"
fi

if [ -d "$PROD_DATA_PATH/_tasks" ]; then
    cp -R "$PROD_DATA_PATH/_tasks" "$TEST_DATA_PATH/"
    echo "   ✅ Copied _tasks/"
fi

if [ -d "$PROD_DATA_PATH/_schedule" ]; then
    cp -R "$PROD_DATA_PATH/_schedule" "$TEST_DATA_PATH/"
    echo "   ✅ Copied _schedule/"
fi

if [ -d "$PROD_DATA_PATH/_inbox" ]; then
    cp -R "$PROD_DATA_PATH/_inbox" "$TEST_DATA_PATH/"
    echo "   ✅ Copied _inbox/"
fi

if [ -d "$PROD_DATA_PATH/_codex" ]; then
    cp -R "$PROD_DATA_PATH/_codex" "$TEST_DATA_PATH/"
    echo "   ✅ Copied _codex/"
fi

# 5. 静的ファイルはシンボリックリンクで共有（オプション）
# ln -s "$(pwd)/public" "$TEST_DATA_PATH/public"

# 6. 開発サーバーを起動
echo "🚀 Starting development server on port $PORT..."
echo "   Data path: $TEST_DATA_PATH"
echo "   URL: http://localhost:$PORT"

# 環境変数を設定して開発サーバーを起動
export PORT=$PORT
export BRAINBASE_ROOT="$TEST_DATA_PATH"
export NODE_ENV=development

# バックグラウンドで起動
npm run dev &
SERVER_PID=$!

echo "   ✅ Server started with PID: $SERVER_PID"
echo ""
echo "📝 To stop the server:"
echo "   kill $SERVER_PID"
echo "   rm -rf $TEST_DATA_PATH"
echo ""
echo "🌐 Opening browser..."
sleep 3
open "http://localhost:$PORT" || xdg-open "http://localhost:$PORT" || echo "   Please open http://localhost:$PORT manually"

# プロセスIDをファイルに保存（後で停止できるように）
echo "$SERVER_PID" > "/tmp/brainbase-dev-server-$PORT.pid"
echo "$TEST_DATA_PATH" > "/tmp/brainbase-dev-server-$PORT.datapath"

echo ""
echo "✅ Dev server for worktree started successfully!"
echo "   Port: $PORT"
echo "   PID: $SERVER_PID"
echo "   Data: $TEST_DATA_PATH"
