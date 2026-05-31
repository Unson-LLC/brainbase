#!/usr/bin/env bash
#
# Codex SessionStart hook: 3層メモリ preamble (個人KG / Graph SSOT カタログ /
# Capability menu) を codex session 冒頭に1回だけ注入する。
#
# 設計 (2026-05-31):
# - Claude Code 側 .claude/scripts/hooks/session-start/inject-memory-preamble.ts
#   の codex 版。codex は母集団の約3割だが従来 hooks 空で何も注入されていなかった。
# - ~/.brainbase/memory-preamble.txt を読むだけ。DB / Lightsail tunnel を hot path
#   に持ち込まない。生成は scripts/generate-memory-preamble.mjs が日次 (oyasumi) or
#   手動で先に materialize する。
# - tsx/node ではなく POSIX shell + python3 で実装し、codex hook 実行の
#   node/esbuild arch mismatch / timeout 飽和の罠を避ける。
# - file が無い/空/古い時は安全に縮退 (continue:true, additionalContext 無し or 警告)。
#
# 出力 schema (codex hookSpecificOutput):
#   {"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart",
#    "additionalContext":"<preamble>"},"suppressOutput":true}

set -euo pipefail

PREAMBLE_PATH="${BRAINBASE_MEMORY_PREAMBLE:-$HOME/.brainbase/memory-preamble.txt}"
STALE_DAYS=2

emit_empty() {
  printf '%s\n' '{"continue":true,"suppressOutput":true}'
  exit 0
}

# file が無い / 読めない → 空注入で縮退
[ -f "$PREAMBLE_PATH" ] || emit_empty

PREAMBLE_PATH="$PREAMBLE_PATH" STALE_DAYS="$STALE_DAYS" python3 - <<'PY' || emit_empty
import json
import os
import time

path = os.environ["PREAMBLE_PATH"]
stale_days = float(os.environ.get("STALE_DAYS", "2"))

try:
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read().strip()
except Exception:
    print('{"continue":true,"suppressOutput":true}')
    raise SystemExit(0)

if not text:
    print('{"continue":true,"suppressOutput":true}')
    raise SystemExit(0)

age_days = (time.time() - os.path.getmtime(path)) / 86400.0
note = ""
if age_days > stale_days:
    note = (
        f" (注意: この preamble は {int(age_days)} 日前のもの。"
        "/oyasumi or generate-memory-preamble.mjs で更新を)"
    )

print(json.dumps({
    "continue": True,
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": text + note,
    },
    "suppressOutput": True,
}, ensure_ascii=False))
PY
