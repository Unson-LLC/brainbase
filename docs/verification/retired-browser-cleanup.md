# 退役ブラウザ実装の除去・検証

Story: `retired-browser-cleanup` / 2026-09-19

## 判定根拠と範囲

- 前提はPR #1646（`624f7056`）とADR-019。新たなruntime所有権変更ではない。
- `server/bootstrap/static-routes.js`の現役HTMLは`/device`。`public/device.html`は独立した`device-auth-controller.js`を読み、旧セッション・端末群を利用しない。
- 削除候補の逆importを確認し、旧UI内で閉じた17モジュールを除去した。対象一覧は`tests/server/bootstrap/retired-browser-boundary.test.js`の`retiredModules`を正本とする。実装は13,123行削除。
- 削除先へのliteral importが残らないこと、実際のstatic配信で対象が404、device認証資材が200、旧app入口が410であることを回帰テストにした。
- 専用テストを除去し、混在するテストの現役HTTP/認証・退役契約は保持する。過去の文書は削除せず、旧実装の存続を要求するテストを修正する。
- `session.create`、`session.hibernation`、`terminal.transport`の現役surfaceは空。旧hibernate実行手順は退役記録へ変更した。

## 証拠の限界

- Brainbase Graph検索は401（Token refresh failed）で本文取得不可。組織Graphの確認済みとは扱わない。
- 実装前Graphifyはpartial、鮮度/影響はunknown、出力切り詰めあり。mainのコードグラフも補助情報とし、対象worktreeの現行ファイルで参照と入口を確認した。
- 実装後もGraphifyを一度更新し、device・新規境界テスト・履歴契約の3ファイルは一致した。ただし結果はpartial/unknownのままで、網羅的な無影響の証明には使っていない。
- ローカルのstatic配信テストは実際のExpressルートを使うが、本番配信・実アカウント認証・端末の手動操作を証明するものではない。
- 17モジュール以外の旧UI資材、過去のsession/archiveデータ、外部OpenRyoko API、稼働プロセス、本番デプロイは対象外。

## 検証

- RED: 削除前の境界テストで対象17モジュールと残存importの18件が失敗し、device配信と退役文書の3件が成功した。
- 保護境界: bootstrap/device/static/retired-capability/auth-device/run-receipt/codex-retirement/server-endpointsの8ファイル48件成功。
- 履歴契約: foundation/session-createのPlaywrightファイル契約13件成功（実ブラウザ操作を伴わない）。
- `tsc --noEmit -p public/jsconfig.json`成功。
- 親PRから維持するGraph/Portal/Mesh/setup契約は6ファイル66件成功。Mesh MCP認証・受付契約9件も成功。

- GREEN: 削除後の新規境界テスト22件、汎用HTTP/CSRF16件成功。
- 旧inline作成/NocoDB入口はファイル契約へ置換し3件成功。退役した静的テストサーバーも設定から除去。
- 更新したproject-provisioning Playwright設定からも残存8件を実行し成功。
- 専用テスト37ファイルを削除。会議ソース同期の現役API/worker契約は保持し、7件中6件成功。残る1件は`project brainbase is not selectable`で失敗し、変更前の`624f7056`でも同じ失敗を再現した。削除/skipせず[Issue #1649](https://github.com/Unson-LLC/brainbase-unson/issues/1649)へ分離。

- 独立レビュー1回でblocking指摘0件。残存するproject.selectorの削除済みコード/テスト参照を修正した。参照切れを検出するテストのREDを確認し、修正後の境界23件と既存mapping契約26件が成功した。

CIの結果はPRで確認する。本番動作確認・デプロイは行っていない。
