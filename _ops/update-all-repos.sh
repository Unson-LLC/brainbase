#!/usr/bin/env bash
set -euo pipefail

# 更新対象: カレント(../)直下〜1階層下に .git があるディレクトリ
# 使い方: _ops/update-all-repos.sh を workspace で実行
# オプション: --no-ff-only で ff-only を外す

FF_ONLY=1
if [[ "${1-}" == "--no-ff-only" ]]; then
  FF_ONLY=0
fi

REPOS=$(find . -maxdepth 2 -name .git -type d -prune \
  | sed 's|/.git$||' | grep -v '^\.$')

for r in $REPOS; do
  echo "== $r =="
  if [[ $FF_ONLY -eq 1 ]]; then
    (cd "$r" && git pull --ff-only)
  else
    (cd "$r" && git pull)
  fi
  echo
done
