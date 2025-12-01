# 全リポジトリ同期

workspace配下の全gitリポジトリをリモートと同期します。

## 実行手順

1. `_ops/update-all-repos.sh` スクリプトを実行
2. 結果を確認して報告

## スクリプトの動作

- workspace配下（最大5階層）の全gitリポジトリを検索
- dirty（未コミット変更あり）なリポジトリはスキップ
- それ以外は `git pull --ff-only` で更新

## オプション

ユーザーが「--no-ff-only」を指定した場合は、fast-forward以外のpullも許可

## 注意事項

- dirtyなリポジトリがある場合は先にコミットまたはstashを提案
- pull失敗時はエラー内容を報告
- 実行前にカレントディレクトリが /Users/ksato/workspace であることを確認
