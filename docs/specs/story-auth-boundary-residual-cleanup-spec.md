# 認証境界の残存互換コード除去 Spec

## Story

`docs/management/stories/active/story-auth-boundary-residual-cleanup.md`

## 目的

既に成功経路から除去されている `insecure-header` の設定・認可残骸を削除し、
認証の拒否境界を狭めずにサーバーの契約を単純化する。

## 実装契約

1. `resolveAuthContext` は認証コンテキストの解決だけを担当し、廃止済みの
   `allowInsecureHeaders` オプションを受け取らない。
2. `requireAuth` は構造化エラーの表示設定だけを任意に受け付ける。全呼出し側は
   死んだ `allowInsecureHeaders: false` を渡さない。
3. Companion と External Runner のサーバー間／ネイティブ認可は既存の
   `internal`、`service-token`、`bearer` の成功ソースを維持し、Run Receipts は既存の
   `internal`、`service-token` の成功ソースを維持する。いずれも `insecure-header` は拒否し、
   既存の明示的な拒否レスポンスは保持する。
4. Info SSOT の `req.access` 不在は `Authenticated access context required` とし、
   controller のHTTPステータス分類は 401 のままにする。

## 受入テスト

- `tests/server/middleware/auth.test.js` と認証呼出し側のテストが、オプションなしの
  `requireAuth` 呼出しで Bearer／Cookie／Slack／Google／service／internal の現行契約を保つ。
- Companion、External Runner、Run Receipts の `insecure-header` は成功せず、既存の拒否コードを返す。
- `tests/server/controllers/info-ssot-controller.test.js` は未認証時のプロバイダー非依存エラーと 401 を確認する。
- 変更対象テストに `allowInsecureHeaders` の参照が残らず、ソースの成功分岐にも
  `insecure-header` を残さない。ただし拒否用fixture・エラーメッセージは残してよい。

## 安全性・非対象

署名検証、token/cookieの解決、Slack Device Flow、Google認証、service/internal認証、
テナント境界、ランタイム設定、デプロイは変更しない。
