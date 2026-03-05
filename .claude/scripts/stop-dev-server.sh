#!/bin/bash

# Stop Dev Server for Worktree
# テスト環境のプロセスを停止し、データを削除

if [ -z "$1" ]; then
    echo "Usage: $0 <port>"
    echo "Example: $0 31014"
    exit 1
fi

PORT=$1
PID_FILE="/tmp/brainbase-dev-server-$PORT.pid"
DATAPATH_FILE="/tmp/brainbase-dev-server-$PORT.datapath"

echo "🛑 Stopping dev server on port $PORT..."

# 1. PIDファイルから プロセスIDを取得
if [ -f "$PID_FILE" ]; then
    SERVER_PID=$(cat "$PID_FILE")
    echo "   Found PID: $SERVER_PID"

    # プロセスを停止
    if kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID"
        echo "   ✅ Process $SERVER_PID stopped"
    else
        echo "   ⚠️  Process $SERVER_PID is not running"
    fi

    # PIDファイルを削除
    rm "$PID_FILE"
else
    echo "   ⚠️  PID file not found, trying to stop by port..."

    # ポートで検索して停止
    if lsof -ti:$PORT >/dev/null 2>&1; then
        lsof -ti:$PORT | xargs kill
        echo "   ✅ Process on port $PORT stopped"
    else
        echo "   ⚠️  No process found on port $PORT"
    fi
fi

# 2. テストデータディレクトリを削除
if [ -f "$DATAPATH_FILE" ]; then
    TEST_DATA_PATH=$(cat "$DATAPATH_FILE")
    echo "   Removing test data: $TEST_DATA_PATH"

    if [ -d "$TEST_DATA_PATH" ]; then
        rm -rf "$TEST_DATA_PATH"
        echo "   ✅ Test data removed"
    fi

    # Datapathファイルを削除
    rm "$DATAPATH_FILE"
else
    echo "   ⚠️  Datapath file not found"
fi

echo ""
echo "✅ Dev server stopped successfully!"
