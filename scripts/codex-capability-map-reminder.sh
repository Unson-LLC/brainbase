#!/bin/bash
# Codex UserPromptSubmit reminder: inject the Brainbase capability map entrypoint.

set -euo pipefail

# Drain stdin so Codex can pass the normal hook payload without blocking this hook.
cat >/dev/null 2>&1 || true

python3 - <<'PY'
import json

context = (
    "Brainbaseケイパビリティ確認リマインダー: Brainbaseの機能、UI/API/コード/データの責務、"
    "プロジェクト/セッション作成、auth grant、31013 runtime、xterm/terminal transport、"
    "表示されない/動かない問題、検証、復旧に触れる依頼では、まずbrainbase-capability-mapを入口にする。"
    "docs/brainbase-capabilities/README.mdを読み、次にdocs/brainbase-capabilities/capabilities/配下の"
    "最小の関連ファイルを確認する。機能が動いていると主張するときは、確認に使ったファイル/API/プロセス/ログを明示する。"
)

print(json.dumps({
    "continue": True,
    "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": context,
    },
    "suppressOutput": True,
}, ensure_ascii=False))
PY
