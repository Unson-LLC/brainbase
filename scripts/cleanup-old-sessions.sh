#!/bin/bash
# Brainbase TMUXセッション & MCPプロセスクリーンアップスクリプト
# 使用例: ./cleanup-old-sessions.sh [days_old]
#   デフォルト: 3日以上前のdetachedセッションを削除

set -e

# 色定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# デフォルト: 3日以上前のセッションをクリーンアップ
DAYS_OLD=${1:-3}
CUTOFF_TIMESTAMP=$(($(date +%s) - (DAYS_OLD * 86400)))

echo -e "${GREEN}=== Brainbase セッションクリーンアップ ===${NC}"
echo "対象: ${DAYS_OLD}日以上前のdetachedセッション"
echo ""

# 現在のセッション一覧を取得
SESSIONS=$(tmux list-sessions -F '#{session_name} #{session_attached} #{session_created}' 2>/dev/null || true)

if [ -z "$SESSIONS" ]; then
    echo -e "${YELLOW}TMUXセッションがありません${NC}"
    exit 0
fi

# クリーンアップ対象をカウント
OLD_SESSIONS=()
while IFS= read -r line; do
    SESSION_NAME=$(echo "$line" | awk '{print $1}')
    ATTACHED=$(echo "$line" | awk '{print $2}')
    CREATED=$(echo "$line" | awk '{print $3}')

    # detachedかつ古いセッションのみ対象
    if [ "$ATTACHED" = "0" ] && [ "$CREATED" -lt "$CUTOFF_TIMESTAMP" ]; then
        OLD_SESSIONS+=("$SESSION_NAME")
    fi
done <<< "$SESSIONS"

if [ ${#OLD_SESSIONS[@]} -eq 0 ]; then
    echo -e "${GREEN}クリーンアップ対象のセッションはありません${NC}"
    exit 0
fi

echo -e "${YELLOW}クリーンアップ対象: ${#OLD_SESSIONS[@]} セッション${NC}"
echo ""

# 確認プロンプト（環境変数で自動承認可能）
if [ "$AUTO_CONFIRM" != "yes" ]; then
    echo "以下のセッションを削除します:"
    for SESSION in "${OLD_SESSIONS[@]}"; do
        echo "  - $SESSION"
    done
    echo ""
    read -p "実行しますか? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}キャンセルされました${NC}"
        exit 0
    fi
fi

# セッション削除
DELETED_COUNT=0
for SESSION in "${OLD_SESSIONS[@]}"; do
    echo -e "${YELLOW}削除中: $SESSION${NC}"
    tmux kill-session -t "$SESSION" 2>/dev/null || echo -e "${RED}  失敗: $SESSION${NC}"
    DELETED_COUNT=$((DELETED_COUNT + 1))
done

echo ""
echo -e "${GREEN}✓ ${DELETED_COUNT} セッションを削除しました${NC}"

# 孤立したMCPプロセスのクリーンアップ（オプション）
echo ""
echo -e "${YELLOW}孤立したMCPプロセスをチェック中...${NC}"

# 現在のTMUXセッションのPIDを取得
ACTIVE_PIDS=$(tmux list-panes -a -F '#{pane_pid}' 2>/dev/null || true)

# MCPプロセスを取得
MCP_PROCESSES=$(ps aux | grep -E 'gmail/src/index.ts|jibble/src/index.ts|brainbase/src/index.ts' | grep -v grep || true)

if [ -z "$MCP_PROCESSES" ]; then
    echo -e "${GREEN}MCPプロセスが見つかりません${NC}"
    exit 0
fi

# 孤立プロセス（TMUXセッションと関連していない）を特定
ORPHANED_PIDS=()
while IFS= read -r line; do
    PID=$(echo "$line" | awk '{print $2}')
    PARENT_PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')

    # 親プロセスがTMUXセッションかチェック
    IS_ACTIVE=false
    for ACTIVE_PID in $ACTIVE_PIDS; do
        if [ "$PARENT_PID" = "$ACTIVE_PID" ]; then
            IS_ACTIVE=true
            break
        fi
    done

    if [ "$IS_ACTIVE" = false ]; then
        ORPHANED_PIDS+=("$PID")
    fi
done <<< "$MCP_PROCESSES"

if [ ${#ORPHANED_PIDS[@]} -eq 0 ]; then
    echo -e "${GREEN}孤立したMCPプロセスはありません${NC}"
    exit 0
fi

echo -e "${YELLOW}孤立したMCPプロセス: ${#ORPHANED_PIDS[@]} 個${NC}"
echo ""

# 確認プロンプト（環境変数で自動承認可能）
if [ "$AUTO_CONFIRM" != "yes" ]; then
    read -p "孤立プロセスを削除しますか? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}スキップしました${NC}"
        exit 0
    fi
fi

# プロセス削除
KILLED_COUNT=0
for PID in "${ORPHANED_PIDS[@]}"; do
    echo -e "${YELLOW}終了中: PID $PID${NC}"
    kill "$PID" 2>/dev/null || echo -e "${RED}  失敗: PID $PID${NC}"
    KILLED_COUNT=$((KILLED_COUNT + 1))
done

echo ""
echo -e "${GREEN}✓ ${KILLED_COUNT} MCPプロセスを終了しました${NC}"
echo ""
echo -e "${GREEN}=== クリーンアップ完了 ===${NC}"
