#!/bin/bash
# auto-handover.sh
#
# Create/refresh HANDOVER.md automatically.
# - Prefer generating from the latest local transcript (Codex or Claude Code).
# - Fall back to a safe stub if generation fails.
# - Best-effort redaction for likely secrets.
#
# Manual:
#   bash .claude/hooks/auto-handover.sh

set -euo pipefail

# Prevent recursive invocation when this script calls an LLM that may trigger hooks.
if [ -n "${BRAINBASE_AUTO_HANDOVER_RUNNING:-}" ]; then
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi

# Skip in tmux automation contexts (consistent with other hooks)
if [ -n "${TMUX:-}" ] && [ -z "${BRAINBASE_SESSION_ID:-}" ]; then
  exit 0
fi

HANDOVER_PATH="$REPO_ROOT/HANDOVER.md"
HANDOVER_DIR="$REPO_ROOT/.claude/handover"
mkdir -p "$HANDOVER_DIR" 2>/dev/null || true

NOW="$(date '+%Y-%m-%d %H:%M %Z')"
STAMP="$(date '+%Y%m%d_%H%M%S')"

_git_branch() {
  git -C "$REPO_ROOT" branch --show-current 2>/dev/null || true
}

_git_status_short() {
  git -C "$REPO_ROOT" status --short 2>/dev/null || true
}

_git_diff_stat() {
  git -C "$REPO_ROOT" diff --stat 2>/dev/null || true
}

_git_log_oneline() {
  git -C "$REPO_ROOT" log --oneline -10 2>/dev/null || true
}

_handover_template() {
  local file="$REPO_ROOT/.claude/commands/handover.md"
  if [ ! -f "$file" ]; then
    return 0
  fi

  # Extract the fenced template block (```markdown ... ```). If not found, return empty.
  awk '
    BEGIN { in_block = 0 }
    /^```markdown[[:space:]]*$/ { in_block = 1; next }
    in_block == 1 && /^```[[:space:]]*$/ { exit }
    in_block == 1 { print }
  ' "$file" 2>/dev/null || true
}

_encode_claude_project_dir() {
  # Claude Code transcript directory encoding: replace /, ., _ with '-'.
  # Example: /Users/ksato/workspace/.worktrees -> -Users-ksato-workspace--worktrees
  printf "%s" "$1" | sed -e 's,/,-,g' -e 's,_,-,g' -e 's,\.,-,g'
}

_find_latest_claude_transcript() {
  local encoded dir
  encoded="$(_encode_claude_project_dir "$REPO_ROOT")"
  dir="$HOME/.claude/projects/$encoded"
  if [ ! -d "$dir" ]; then
    return 1
  fi
  ls -t "$dir"/*.jsonl 2>/dev/null | head -n 1
}

_extract_claude_conversation() {
  local transcript="$1"
  local max_chars="${2:-200000}"

  jq -r '
    select(.type == "user" or .type == "assistant") |
    select((.isMeta // false) == false) |
    if .type == "user" then
      "USER: " + (.message.content // "")
    elif .type == "assistant" then
      "ASSISTANT: " + (
        if .message.content | type == "array" then
          [.message.content[] | select(.type == "text") | .text] | join(" ")
        else
          .message.content // ""
        end
      )
    else
      empty
    end
  ' "$transcript" 2>/dev/null | head -c "$max_chars"
}

_find_latest_codex_rollout() {
  # Search recent Codex sessions (last 2 days) for the newest rollout that matches this repo.
  local f cwd

  while IFS= read -r f; do
    cwd="$(python3 - "$f" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, 'r', encoding='utf-8', errors='replace') as fp:
        first = fp.readline()
    if not first:
        raise SystemExit(1)
    obj = json.loads(first)
    if obj.get('type') != 'session_meta':
        raise SystemExit(1)
    payload = obj.get('payload') or {}
    print(payload.get('cwd') or '')
except Exception:
    raise SystemExit(1)
PY
)" || cwd=""

    if [ -n "$cwd" ] && [[ "$cwd" == "$REPO_ROOT"* ]]; then
      echo "$f"
      return 0
    fi
  done < <(
    find "$HOME/.codex/sessions" -type f -name 'rollout-*.jsonl' -mtime -2 -print0 2>/dev/null \
      | xargs -0 ls -t 2>/dev/null
  )

  return 1
}

_extract_codex_conversation() {
  local transcript="$1"
  local max_chars="${2:-200000}"

  python3 - "$transcript" "$max_chars" <<'PY'
import json
import sys

path = sys.argv[1]
max_chars = int(sys.argv[2])

lines = []
total = 0

def add(prefix: str, text: str) -> None:
    global total
    text = (text or '').strip()
    if not text:
        return
    if len(text) > 4000:
        text = text[:4000] + " ... [TRUNCATED]"
    s = f"{prefix}: {text}"
    lines.append(s)
    total += len(s) + 1

with open(path, 'r', encoding='utf-8', errors='replace') as fp:
    for raw in fp:
        try:
            obj = json.loads(raw)
        except Exception:
            continue

        if obj.get('type') != 'response_item':
            continue

        payload = obj.get('payload') or {}
        role = payload.get('role')
        if role not in ('user', 'assistant'):
            continue

        content = payload.get('content') or []
        parts = []
        for part in content:
            if part.get('type') in ('input_text', 'output_text'):
                parts.append(part.get('text') or '')
        text = ''.join(parts)

        if role == 'user':
            add('USER', text)
        else:
            add('ASSISTANT', text)

        if total >= max_chars:
            break

sys.stdout.write('\n'.join(lines)[:max_chars])
PY
}

_redact_secrets() {
  # Best-effort redaction for common secret patterns.
  # Conservative: redact only when a key-like prefix is present, or token formats are obvious.
  python3 -c '
import re
import sys

s = sys.stdin.read()
s = re.sub(
    r"(?i)(\\b(?:SECRET|TOKEN|API[_ -]?KEY|BEARER|PASSWORD|ACCESS[_ -]?TOKEN|REFRESH[_ -]?TOKEN)\\b\\s*[:=]\\s*)([^\\s`]{8,})",
    r"\\1<REDACTED>",
    s,
)
s = re.sub(r"(xox[baprs]-)[A-Za-z0-9-]+", r"\\1<REDACTED>", s)
s = re.sub(r"\\bgh[pousr]_[A-Za-z0-9]{20,}\\b", "gh_<REDACTED>", s)
s = re.sub(r"\\bpat[A-Za-z0-9_.]{10,}\\b", "pat_<REDACTED>", s)
s = re.sub(r"\\bsk-[A-Za-z0-9]{20,}\\b", "sk-<REDACTED>", s)
sys.stdout.write(s)
' 2>/dev/null || cat
}

_unwrap_top_fence() {
  # Normalize model output into the final HANDOVER.md body:
  # - Prefer a fenced block that contains "# HANDOVER" and extract its body
  # - Else, drop any leading chatter before the first "# HANDOVER"
  # - Ensure the output ends with a newline
  python3 -c '
import re
import sys

s = sys.stdin.read()

# Prefer a fenced block that contains "# HANDOVER"
for m in re.finditer(r"```[^\\n]*\\n(.*?)\\n```", s, flags=re.S):
    body = m.group(1)
    if re.search(r"(?m)^#\\s*HANDOVER\\b", body):
        sys.stdout.write(body.strip() + \"\\n\")
        sys.exit(0)

# If the whole output is fenced, unwrap it.
m = re.fullmatch(r"```[^\\n]*\\n(.*)\\n```\\s*", s, flags=re.S)
if m and re.search(r"(?m)^#\\s*HANDOVER\\b", m.group(1)):
    sys.stdout.write(m.group(1).strip() + \"\\n\")
    sys.exit(0)

# Drop chatter before "# HANDOVER"
m = re.search(r"(?m)^#\\s*HANDOVER\\b.*$", s)
if m:
    sys.stdout.write(s[m.start():].strip() + \"\\n\")
else:
    sys.stdout.write(s)
' 2>/dev/null || cat
}

_write_stub() {
  local branch
  branch="$(_git_branch)"

  {
    echo "# HANDOVER"
    echo ""
    echo "- Generated At: $NOW"
    echo "- Branch: ${branch:-}"
    echo "- Repo: $REPO_ROOT"
    echo "- Session Goal: 不明（自動生成に失敗）"
    echo ""
    echo "## 1. 今回やったこと（完了）"
    echo "- 不明（自動生成に失敗）"
    echo ""
    echo "## 2. 未完了・保留"
    echo "- 不明（自動生成に失敗）"
    echo ""
    echo "## 3. 重要な判断と理由"
    echo "- 不明（自動生成に失敗）"
    echo ""
    echo "## 4. 問題・ハマりどころと対処"
    echo "- 不明（自動生成に失敗）"
    echo ""
    echo "## 5. 変更ファイルマップ"
    echo "### git status --short"
    echo '```'
    _git_status_short
    echo '```'
    echo ""
    echo "### git diff --stat"
    echo '```'
    _git_diff_stat
    echo '```'
    echo ""
    echo "## 6. 検証結果"
    echo "- 不明（自動生成に失敗）"
    echo ""
    echo "## 7. 次セッションの最初のアクション（3つ）"
    echo '1. `.claude/commands/handover.md` を読んで手動で埋める'
    echo '2. `git status --short` / `git diff --stat` を確認して変更点を把握'
    echo "3. 未完了タスクとブロッカーを整理"
    echo ""
    echo "## 8. 参照情報"
    echo "- 不明（自動生成に失敗）"
  } > "$HANDOVER_PATH" 2>/dev/null || true
}

_generate_with_claude() {
  local transcript_text="$1"
  local prompt_dir="${TMPDIR:-/tmp}/brainbase-auto-handover"
  mkdir -p "$prompt_dir" 2>/dev/null || true
  local prompt_file="$prompt_dir/auto_handover_prompt_${STAMP}.txt"
  local template
  template="$(_handover_template)"

  cat > "$prompt_file" <<'PROMPT_EOF'
あなたはソフトウェア開発の引き継ぎ担当です。
次の担当者が **5分で再開できる** ように、プロジェクトルートの `HANDOVER.md` の内容（Markdown）だけを出力してください。

厳守:
- 出力は **Markdownのみ**。説明文や前置きは不要。
- 出力は **日本語**。
- 最初の行は必ず `# HANDOVER` にする（それ以外の先頭行は禁止）。
- ``` を一切出力しない（コードフェンス禁止）。
- 下の「テンプレート」をベースに、コードフェンス無しで最終 `HANDOVER.md` を出力。
- 推測で埋めない。わからない点は「不明」と書く。
- 日付は相対表現ではなく絶対日付（YYYY-MM-DD）。
- **秘密情報（APIキー/トークン/パスワード等）は絶対に出力しない**。必要なら「<REDACTED>」に置換。
PROMPT_EOF

  if [ -n "$template" ]; then
    {
      echo ""
      echo "テンプレート:"
      echo '```markdown'
      printf "%s\n" "$template"
      echo '```'
    } >> "$prompt_file"
  fi

  {
    echo ""
    echo "メタ:"
    echo "- Generated At: $NOW"
    echo "- Branch: $(_git_branch)"
    echo "- Repo: $REPO_ROOT"
    echo ""
    echo "---"
    echo "git status --short:"
    echo "\`\`\`"
    _git_status_short
    echo "\`\`\`"
    echo ""
    echo "---"
    echo "git diff --stat:"
    echo "\`\`\`"
    _git_diff_stat
    echo "\`\`\`"
    echo ""
    echo "---"
    echo "git log --oneline -10:"
    echo "\`\`\`"
    _git_log_oneline
    echo "\`\`\`"
    echo ""
    echo "---"
    echo "transcript:"
    echo "\`\`\`"
    printf "%s\n" "$transcript_text"
    echo "\`\`\`"
  } >> "$prompt_file"

  # Ensure no tools are used; only generate Markdown text.
  if [ -n "${BRAINBASE_AUTO_HANDOVER_DEBUG:-}" ]; then
    BRAINBASE_AUTO_HANDOVER_RUNNING=1 TMUX=1 claude -p --model haiku --no-session-persistence --output-format text --tools=\"\" "@$prompt_file"
  else
    BRAINBASE_AUTO_HANDOVER_RUNNING=1 TMUX=1 claude -p --model haiku --no-session-persistence --output-format text --tools=\"\" "@$prompt_file" 2>/dev/null
    rm -f "$prompt_file" 2>/dev/null || true
  fi
}

_main() {
  local claude_path="" codex_path="" source="none"
  local transcript_text=""
  local tmp_dir="${TMPDIR:-/tmp}/brainbase-auto-handover"
  mkdir -p "$tmp_dir" 2>/dev/null || true
  local tmp_out="$tmp_dir/handover_${STAMP}.tmp"

  claude_path="$(_find_latest_claude_transcript 2>/dev/null || true)"
  codex_path="$(_find_latest_codex_rollout 2>/dev/null || true)"

  local claude_mtime=0 codex_mtime=0 now_epoch
  now_epoch="$(date +%s)"

  if [ -n "$claude_path" ] && [ -f "$claude_path" ]; then
    claude_mtime=$(stat -f%m "$claude_path" 2>/dev/null || echo 0)
  fi
  if [ -n "$codex_path" ] && [ -f "$codex_path" ]; then
    codex_mtime=$(stat -f%m "$codex_path" 2>/dev/null || echo 0)
  fi

  if [ "$claude_mtime" -gt 0 ] && [ $((now_epoch - claude_mtime)) -le 7200 ]; then
    source="claude"
  fi
  if [ "$codex_mtime" -gt 0 ] && [ $((now_epoch - codex_mtime)) -le 7200 ]; then
    if [ "$codex_mtime" -gt "$claude_mtime" ]; then
      source="codex"
    elif [ "$source" = "none" ]; then
      source="codex"
    fi
  fi

  if [ "$source" = "claude" ] && [ -n "$claude_path" ]; then
    transcript_text="$(_extract_claude_conversation "$claude_path" 200000 || true)"
  elif [ "$source" = "codex" ] && [ -n "$codex_path" ]; then
    transcript_text="$(_extract_codex_conversation "$codex_path" 200000 || true)"
  fi

  # Backup existing HANDOVER.md (if any), then overwrite.
  if [ -f "$HANDOVER_PATH" ] && [ -s "$HANDOVER_PATH" ]; then
    cp "$HANDOVER_PATH" "$HANDOVER_DIR/HANDOVER_${STAMP}_previous.md" 2>/dev/null || true
  fi

  if command -v claude >/dev/null 2>&1; then
    if [ -n "${BRAINBASE_AUTO_HANDOVER_DEBUG:-}" ]; then
      if _generate_with_claude "$transcript_text" > "$tmp_out"; then
        :
      fi
    else
      if _generate_with_claude "$transcript_text" > "$tmp_out" 2>/dev/null; then
        :
      fi
    fi

    if [ -s "$tmp_out" ]; then
      if _redact_secrets < "$tmp_out" | _unwrap_top_fence > "$HANDOVER_PATH" 2>/dev/null && [ -s "$HANDOVER_PATH" ]; then
        :
      else
        _write_stub
      fi
    else
      _write_stub
    fi
  else
    _write_stub
  fi

  # Keep a dated copy for history.
  if [ -f "$HANDOVER_PATH" ] && [ -s "$HANDOVER_PATH" ]; then
    cp "$HANDOVER_PATH" "$HANDOVER_DIR/HANDOVER_${STAMP}.md" 2>/dev/null || true
  fi

  rm -f "$tmp_out" 2>/dev/null || true
}

_main || true
