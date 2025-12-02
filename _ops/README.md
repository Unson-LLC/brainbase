# _ops ディレクトリ

共通オペ用のスクリプト置き場。リポジトリ横断の作業スクリプトはここに配置する。

## スクリプト一覧
- `update-all-repos.sh`
  - カレントから1階層下までの子リポジトリを自動検出して `git pull --ff-only` 実行。
  - オプション `--no-ff-only` で通常の `git pull`。

- `sync-slack-to-dynamodb.js`
  - brainbase YAML（`_codex/common/meta/slack/channels.yml`）をDynamoDBへ同期。
  - オプション `--dry-run` で実際の更新をスキップして確認のみ。
  - マスタ: YAML、キャッシュ: DynamoDB（slack-classify-bot-projects）

## 使い方
```
# workspace直下で実行
./_ops/update-all-repos.sh
# ff-onlyを外す場合
./_ops/update-all-repos.sh --no-ff-only
```

## 運用メモ
- `_ops` は `.gitignore` されているため、必要に応じて `git add -f` でコミット。
- 破壊的なスクリプトは入れない。実行前に必ず中身を確認すること。
