# 判断Host共通契約 v1

## 目的

判断Hostと組織adapterの境界で、実行結果・ノード根拠・完了回答・knowledge event配送の共通形を共有する。Task、tenant、認証、HTTP readbackの所有権はadapterに残し、共通coreは注入された状態rootのキュー処理だけを所有する。

## 契約境界

| 公開module | 所有する処理 | 所有しない処理 |
| --- | --- | --- |
| `judgment-execution-outcome` | 実行状態、段階、失敗、再開位置、証拠参照の検証 | transcript、process、Task、SQLite、外部readback |
| `judgment-node-evidence` | ノード結果の正規化、成功業務イベントとの順序付き結合 | tool実行、transcript保存、Hostの権限判定 |
| `judgment-event-adapter` | 完了回答の監査行除去、秘密隔離、非権威knowledge event投影 | 組織ID、Task保存、outbox配送、グラフ昇格 |
| `judgment-event-outbox` | `varDir`/`root`注入、原子enqueue、event-id冪等性、sender lock、post/readback再送、receipt/dead-letter | Task・continuation、tenant/組織ID、認証、HTTP relay、canonical readback URL |
| `judgment-host` | 既存Hostの公開入口 | 新しい別Hostの複製 |

## 不変条件

1. 未完了の実行結果は失敗理由と再開位置を持つ。
2. 完了したhost turnは `finalize`、外部効果は `readback` まで到達し、確認済み証拠参照を1件以上持つ。
3. ノード根拠は先行する成功済み業務イベントに結び付く。制御イベント、空検索、判断記録自体は根拠にしない。
4. knowledge eventは `authorized=false` かつ `graph_promotion_allowed=false` で、秘密らしい回答は `quarantined` とする。
5. runtimeのTask/receipt/tenant/auth/HTTP実装はHost adapterから明示的に注入し、OSS共通部品が組織固有の認証・秘密・絶対パスに依存しない。
6. outboxは同一eventを再enqueueしても1件に留まり、post成功後のreadback失敗ではackを保持してpostを再実行しない。transport障害はpost attemptを消費せず、sender lockは同時配送を1実行に制限する。

## 互換性と移行

既存OSS Hostの外部振舞いと既存テストを維持し、公開subpathを追加する。consumerは公開npm版を参照せず、ローカルtarballで組み込み確認を行う。現行runtimeは `varDir` とadapter portを渡し、HTTP/auth/org/Task/readbackの実装を維持したまま、OSS coreへqueue/retry/lock/receipt処理を委譲できる。切替、旧配置削除、npm公開、merge、本番配備は別の承認境界とする。
