# ADR: Personal Vaultと組織イベントを同一クラスタ内で論理分離する

- 日付: 2026-08-14
- 状態: 採用

## 決定

初期構成は一つのPostgreSQLクラスタ内に、owner-scopedなPersonal Vaultとorganization-scopedな組織イベント領域を論理分離する。

- `personal_knowledge_events`: 個人記憶の不変な正本
- `knowledge_events`: 組織由来および本人承認済み共有イベントの唯一の正本
- `memory_candidates`: 抽出、昇格、検索の候補キュー／投影
- Graph SSOT: 現在有効な組織の事実、判断、RACI
- `info_ssot.events`: Graph変更の監査投影
- `workflow-ledger.json`: 実行証跡とOutboxの互換投影

イベントのcapture scopeは取得時に固定し、同じレコードを個人から組織へ変更しない。個人から組織へ共有する場合は、秘密、個人情報、個人パス、原文引用を除いたプレビューを本人が承認し、決定的IDを持つ新しい組織イベントを発行する。lineageは残すが個人原文を越境させない。

## 認可境界

APIは`owner_person_id`と`organization_id`を本文やqueryから採用せず、認証コンテキストから確定する。サービス代理アクセスは代理対象と組織を明示し、監査行を残す。

PostgreSQL transactionは`SET LOCAL`でperson、organization、project、role、clearanceを設定する。個人イベント、transition、候補、昇格関係はRLSを`ENABLE`かつ`FORCE`する。組織イベント、transition、Episode圧縮物も同じorganization、project、role、clearanceを継承する。現在状態ビューは`security_invoker`として呼出者のRLSを迂回しない。

## 不変性と現在状態

イベント包絡、transition、lineageは追記専用とする。訂正と撤回は新イベントとtransitionで表現する。組織イベントの現在状態は`knowledge_event_current`読取モデルから得る。Episode圧縮は専用artifactへ保存し、元イベントの`result`を更新しない。

## ロールバックと導入

`BRAINBASE_PERSONAL_VAULT_READ_ENABLED=0`は`/ohayo`の個人想起だけを旧Candidate投影へ戻す。新しい正本への書込み、不変履歴、RLSは無効化しない。旧データは削除せず、不明なowner、organization、projectは隔離する。

新経路を2週間かつ3ルーティン7回連続で観測し、実PostgreSQLのRLSと実Graph閉ループを確認するまで互換読取りを残す。物理DB分離、スコープ別暗号鍵、完全な全read監査は後続判断とする。

## 帰結

メンバー全員が同じ生ログを読む共有Ledgerは作らない。全員が恩恵を受ける対象は、許可された組織イベントからコンパイルされたGraphである。個人原文は本人領域に残り、共有されるのは洗浄・承認された蒸留物だけになる。
