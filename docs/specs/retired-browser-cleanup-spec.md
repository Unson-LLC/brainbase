# 退役ブラウザ実装除去の仕様

Story: `retired-browser-cleanup`

## 削除判定

- `server/bootstrap/static-routes.js`と配信対象HTMLを入口とし、現役Device認証への参照を保護する。
- 削除候補への逆参照を調べ、現役のserver/lib/scripts/MCPから利用される共通部品は残す。
- 旧UI内部の依存は閉じたまとまりとして除去する。未確認の共通部品・外部OpenRyokoのsession APIは削除対象にしない。
- 実データの保存先には触れない。履歴文書は退役表示のうえ保存し、実装復旧の指示と分離する。

## テストケース

1. 対象の退役実装ファイルが存在しない。削除前に失敗することを確認する。
2. 残る実行コードから削除先へのimportがない。
3. 実際のstatic routeで`/device`とそのモジュールが配信でき、旧アプリは復活しない。
4. `/api/state`、`/api/sessions`、`/api/terminal`の退役契約とRun Receiptの既存契約が維持される。
5. App Serverの履歴テストは文書と空の現役能力境界を確認し、削除したソース/専用テストの存在を要求しない。

対象一覧と検証結果は`docs/verification/retired-browser-cleanup.md`へ記録する。Graph/Graphifyの不足は影響なしとは扱わず、現行ファイルの参照調査で補う。
