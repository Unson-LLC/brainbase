# 認証境界の残存互換コードを除去する

## 利用者成果

現行の正規認証だけがサーバーの認証・サーバー間認可を通過し、廃止済みの
`allowInsecureHeaders` 設定と非本番限定の `insecure-header` 受入経路が残らない。
Info SSOT の未認証エラーは認証プロバイダー名に依存しない。

## 受入条件

- `requireAuth` の公開オプションは構造化エラー設定だけとし、全サーバー呼出しから
  `allowInsecureHeaders` を除去する。
- `insecure-header` は成功する認証ソースとして扱わない。Bearer、Cookie、Slack、Google、
  service-token、internal の既存経路と、既存の拒否・fail-closed 分岐は維持する。
- Companion、External Runner、Run Receipts のサーバー間認可で、廃止済みの
  `insecure-header` を許可しない。
- Info SSOT の `req.access` 不在エラーはプロバイダー非依存の文言で 401 に分類する。
- 変更対象の既存テストを更新し、正規経路と拒否経路を検証する。

## 範囲外

Slack／Google の認証方式変更、トークン・秘密情報の変更、保存データの削除、ランタイム設定・
デプロイ、本番の外部反映はこのStoryに含めない。

## 検証

実装後に認証middleware、対象route、Info SSOT controller の対象テストを実行する。
Graphify の影響結果が partial または freshness unknown の場合は、影響なしの根拠にしない。
