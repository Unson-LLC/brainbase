# _ops ディレクトリ

共通オペ用のスクリプト置き場（ローカル・一時的ユーティリティ）。リポジトリ横断の作業スクリプトはここに配置する。

## スクリプト一覧
- `update-all-repos.sh`
  - カレントから1階層下までの子リポジトリを自動検出して `git pull --ff-only` 実行。
  - オプション `--no-ff-only` で通常の `git pull`。
  - ff-only失敗時は自動でrebaseを試行。

## 使い方
```
# workspace直下で実行
./_ops/update-all-repos.sh
# ff-onlyを外す場合
./_ops/update-all-repos.sh --no-ff-only
```

## 備考
- **Slackチャンネル同期**: `_codex/common/meta/slack/channels.yml` → GitHub Actions (`sync-brainbase-context.yml`) → S3 経由で自動同期

## 運用メモ
- `_ops` は `.gitignore` されているため、必要に応じて `git add -f` でコミット。
- 破壊的なスクリプトは入れない。実行前に必ず中身を確認すること。
- 公式・共有資産は `_codex/common/ops` に置く。ここは試験・ローカル用。
