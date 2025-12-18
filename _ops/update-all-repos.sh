#!/usr/bin/env bash
set -euo pipefail

# 更新対象: カレント(../)直下〜1階層下に .git があるディレクトリ
# 使い方: _ops/update-all-repos.sh を workspace で実行
# オプション: --no-ff-only で ff-only を外す

FF_ONLY=1
if [[ "${1-}" == "--no-ff-only" ]]; then
  FF_ONLY=0
fi

REPOS=$(find . -maxdepth 5 -name .git -type d -print \
  | sed 's|/.git$||' | grep -v '^\.$')

DIRTY=()
BROKEN=()
for r in $REPOS; do
  STATUS=$(cd "$r" && git status --porcelain 2>&1) || {
    BROKEN+=("$r")
    continue
  }
  if [[ -n "$STATUS" ]]; then
    DIRTY+=("$r")
  fi
done

if [[ ${#BROKEN[@]:-0} -gt 0 ]]; then
  echo "Broken repositories (skipped):"
  for b in "${BROKEN[@]}"; do
    echo " - $b"
  done
  echo
fi

if [[ ${#DIRTY[@]:-0} -gt 0 ]]; then
  echo "Dirty repositories (skipped):"
  for d in "${DIRTY[@]}"; do
    echo " - $d"
  done
  echo
fi

for r in $REPOS; do
  echo "== $r =="
  if printf '%s\n' "${BROKEN[@]:-}" | grep -qx "$r"; then
    echo " ! broken repo, skipped."
    echo
    continue
  fi
  if printf '%s\n' "${DIRTY[@]:-}" | grep -qx "$r"; then
    echo " ! dirty working tree, skipped."
    echo
    continue
  fi
  if [[ $FF_ONLY -eq 1 ]]; then
    # ff-only失敗時は自動でrebaseを試みる
    (cd "$r" && git pull --ff-only 2>/dev/null) || {
      echo " → ff-only failed, trying rebase..."
      (cd "$r" && git pull --rebase) || echo " ! rebase also failed: $r"
    }
  else
    (cd "$r" && git pull) || echo " ! pull failed: $r"
  fi
  echo
done
