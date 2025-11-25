#!/usr/bin/env bash
set -euo pipefail

# 更新対象: カレント(../)直下〜1階層下に .git があるディレクトリ
# 使い方: _ops/update-all-repos.sh を workspace で実行
# オプション: --no-ff-only で ff-only を外す

FF_ONLY=1
if [[ "${1-}" == "--no-ff-only" ]]; then
  FF_ONLY=0
fi

REPOS=$(find . -maxdepth 5 -name .git -print \
  | sed 's|/.git$||' | grep -v '^\.$')

DIRTY=()
for r in $REPOS; do
  STATUS=$(cd "$r" && git status --porcelain)
  if [[ -n "$STATUS" ]]; then
    DIRTY+=("$r")
  fi
done

if [[ ${#DIRTY[@]} -gt 0 ]]; then
  echo "Dirty repositories (skipped):"
  for d in "${DIRTY[@]}"; do
    echo " - $d"
  end
  echo
fi

for r in $REPOS; do
  echo "== $r =="
  if printf '%s\n' "${DIRTY[@]}" | grep -qx "$r"; then
    echo " ! dirty working tree, skipped."
    echo
    continue
  fi
  if [[ $FF_ONLY -eq 1 ]]; then
    (cd "$r" && git pull --ff-only) || echo " ! pull failed: $r"
  else
    (cd "$r" && git pull) || echo " ! pull failed: $r"
  fi
  echo
done
