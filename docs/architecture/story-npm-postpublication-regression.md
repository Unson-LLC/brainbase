# 公開後の通常回帰に関する設計

## 決定

公開前専用テストは削除せず、`test:integration:release-evidence` からだけ実行する。通常の `npm test` はそのファイルを明示的に除外する。

公開前専用スクリプトは、対象versionのregistry不存在、clean HEAD、production dependency audit、tarball hashとintegrityを引き続きfail-closedで検査する。公開後に同じversionが存在することは正常な状態なので、通常回帰の失敗条件にはしない。

## 影響範囲

- `package.json` のテストコマンド
- 既存npm公開Storyの受け入れテスト

実装コード、package API、version、公開処理は変更しない。
