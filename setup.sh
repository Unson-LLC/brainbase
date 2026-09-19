#!/bin/bash

# Legacy setup entrypoint intentionally retired.
set -e

cat >&2 <<'EOF'
Brainbaseの旧セットアップ入口は退役しました。
既存のデータや state.json は変更しません。
セットアップが必要な場合は、リポジトリルートで `npm run setup` を実行してください。
このスクリプトは canonical な scripts/setup.sh を自動実行しません。
EOF

exit 1
