# 旧操作面の残存整理

Story: [legacy-surface-completion](../stories/story-legacy-surface-completion.md)

## 判断と調査範囲

基準は develop `a61beba3ab83ce57afb1ef5897b7f1ea751a5fd6`。前回は入口と17モジュールを除去したが、その配下の汎用名の部品と専用テストを残していた。テストがあることを現役利用の証拠にはせず、配信入口・import・手動スクリプト・運用手順を照合する。

対立仮説は「共通部品が現役API、CLI、device認証から利用される」。`device.html` が読むのは専用controllerのみであり、そのcontrollerに他のブラウザモジュールのimportはない。server/lib/CLI/MCPから旧ブラウザ実装への現役importも確認できなかった。外部利用者の任意URLアクセス履歴まで確認したわけではない。ADR-019に従い、退役済み操作面のファイル配信は維持しない。

## 公開資材の分類

| 対象 | 責任・利用者 | 処置 |
|---|---|---|
| `public/device.html` | 本人認証・OAuth・同意 | 維持 |
| `public/modules/device/device-auth-controller.js` | device認証専用 | 維持 |
| `public/favicon.png` | ブラウザのアイコン | 維持 |
| `public/jsconfig.json` | 開発時の型検査 | 維持。HTTP配信しない |
| 上記以外の121資材 | 入口が退役したブラウザ実装・アイコン・manifest | 削除済み |
| 専用テスト86ファイル・手動selectorデモ・旧設定UIのタスク生成script | 廃止実装のみを検証・操作 | 削除済み。現役API契約は維持 |
| config/state.sample.json | 旧session用のサンプル。実データではない | 削除済み |

全公開資材を列挙するテストで4ファイルだけを許可する。静的配信も3資材の許可リストとし、旧ファイルが配備先に残っても再公開しない。`/app.js` の410、rootのAPI案内、`/device` は維持する。

## 状態の正本と保護境界

- task/thread/worktree/terminalはCodex app/CLIの責任。Brainbaseの旧SQLite/JSON store、復元、監視、保存処理を戻さない。
- 過去のsession/archive DB/JSONは移行証跡であり、今回読み書き・移動・削除しない。
- `lib/runtime-paths.js` の `BRAINBASE_STATE_PATH` は旧名だが、親ディレクトリが現役runtimeのvar/uploads/PID/port配置を決める。単純削除すると既存配置を変えるため維持する。`config-controller.js` の `stateFile` は互換パス投影であり、session状態を保存する正本ではない。
- Meeting Source等の個別stateは別ドメインの現役データ。旧sessionという理由で一括削除しない。
- 本番配備や外部runtimeの停止は本変更に含めない。

## 根拠の限界

Graph検索は401で本文を取得できず、組織Graphの設計確認は未達。Graphify更新後はstatic route、device controller、境界testの3件を取得しtruncated=falseだったが、freshness/impactはunknownであり、影響なしの根拠には使わない。判断は現行ソース、既存ADR、参照照合、対象テストに基づく。

## 運用手順・依存

- session-restoreの旧JSON正本・環境変数注入手順を廃止し、所有アプリの履歴へ案内する。
- 独立レビューで発見したttyd-websocket-troubleshootingの旧API再起動手順も除去し、所有アプリへの案内にした。退役APIへの操作指示が復活しないことを境界testで固定する。
- brainbase-ops-guideは旧DB編集などの重複手順を除き、現行capability/専用Skillへの入口にした。capability-mapの旧機能indexも廃止済みと明示した。
- 存在しない設定・テストを呼ぶmobile用npm script 3件を削除した。
- assistant-ui 3件、React/ReactDOM、xterm/headlessの直接依存6件を削除した。prototypeのCDN利用はnpm依存ではない。esbuild等の現役依存は保持した。
- Node 22.23.2 / npm 10.9.8のlock-only更新でpackage entry 296件を除去。新規package entryと既存version変更は0件。共有node_modulesは変更していない。
- 全Skill・全ドメインの全面監査ではない。旧名称を含む残存を一括削除せず、個々の所有者・consumer・互換性を確かめる必要がある。

## 検証

- RED: 公開資材4件の制限は削除前に失敗。stale legacy.jsの404は配信許可リスト化前に200で失敗。
- GREEN: 静的配信・device・旧ブラウザ境界の36テスト成功（旧Skill復旧手順の再導入防止を含む）。
- 現役Auth Grant、Canonical Task、API clientの31テスト成功。
- Core退役境界・Device承認・Run Receipt・Portal・Mesh・runtime paths等の12ファイル101テスト成功。
- Mesh MCPの9テスト成功。ローカルesbuildのCPU違いは既存binary指定で解決し、共有依存は変更していない。
- Playwrightによる退役契約16件成功。ブラウザ実機操作のE2Eとは区別する。
- public型検査、git diff --check成功。
- 独立レビューとCIの結果はこの変更のPRに記録する。本番反映は対象外。
