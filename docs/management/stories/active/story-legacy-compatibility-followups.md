# レガシー退役後の互換境界の追加検証

## 利用者成果

残存コードを実利用と混同せず、削除可能な互換処理と保護する正規経路を根拠付きで分離する。

## 今回の退役変更を妨げない追加作業

- Wikiの保存済みデータを読む2本のスクリプトについて、`--dry-run`時の無書込みと読取失敗時の挙動をfixtureで固定する。非dry-runの接続前拒否は既に検証対象。
- サーバーの非本番`insecure-header`互換とInfo SSOT controller直接fallbackについて、既存テストを正規認証fixtureへ移せるか確認する。本番では当該header認証は無効で、Slackと`bbsvc_`サービス認証は別経路。共有認証を一括削除しない。
- `vibepro-graph-ssot-check.mjs`、`ontology-release-publish.js`、`generate-memory-preamble.mjs`はBearerを要求する内部クライアント。スクリプト全体ではなく、冗長な`x-brainbase-*`ヘッダーの除去を個別に検証する。
- CLIの認証保存ではDevice Flowの応答に`expires_at`がなければ30日後を保存する一方、取得済みJWTはより早く失効し得る。期限判定・refresh token保持を別の認証修正として検証する。JWT payloadのデコードは署名検証ではなく、401の正式な原因判定はサーバー側の検証結果と区別する。

## 受入条件

各変更は独立した最小Specと対象テストを持ち、Slack Device Flow、保存済みの有効な認証、他テナントのGoogle認証、共有Personal KG・learning・サービス認証を維持する。旧Wiki/SQLite/JSONデータの削除や、秘密情報の変更を含めない。

## 未確認

外部コピー、別mount、全ホストの利用状況は未確認。静的参照があることだけを実利用の証拠とせず、参照が見つからないことだけを全範囲の不在証明としない。
