# Info SSOT 認証コンテキスト移行 Spec

## Story

`docs/management/stories/active/story-legacy-compatibility-followups.md` のうち、Info SSOT controller 直接fallbackの退役を対象とする。

## 利用者成果

Info SSOT の controller が、検証済みの `req.access` だけを認可コンテキストとして使う。直接routerを組み込んだ経路でも、利用者が送った `x-brainbase-*` ヘッダーだけで権限を得られない。

## 受入条件

- `req.access` がない要求は `401` で終了し、Info SSOT serviceを呼び出さない。
- `req.access` がある要求は、既存のrole・project・clearance判定とサービス呼び出しを維持する。
- 直接routerテストは、検証済み認証を模擬する test-only fixture から `req.access` を注入する。
- production の Bearer/Slack/bbsvc/Google 認証と、`server/middleware/auth.js` の非本番互換境界は変更しない。

## 検証

- `tests/server/controllers/info-ssot-controller.test.js`
- `tests/server/routes/info-ssot-context.test.js`
- `tests/server/routes/graph-vector-search.test.js`
- `tests/server/routes/info-ssot-sim.test.js`（DB設定時）
- `tests/server/routes/info-ssot-graph.test.js`（DB設定時）

## 対象外

認証middleware全体の退役、共有認証の削除、CI workflow、既存データの削除、本番反映・push。
