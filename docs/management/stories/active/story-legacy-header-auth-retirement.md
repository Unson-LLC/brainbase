---
story_id: story-legacy-header-auth-retirement
title: 共有認証から非本番自己申告header fallbackを退役させる
spec_docs:
  - docs/specs/story-legacy-header-auth-retirement-spec.md
architecture_docs: []
status: in_progress
created_at: 2026-09-20
updated_at: 2026-09-20
---

# 共有認証から非本番自己申告header fallbackを退役させる

Brainbaseの利用者として、`BRAINBASE_TEST_MODE`などの非本番フラグが有効でも、利用者が送ったrole・project・clearance headerだけで認証済みにならない状態にしたい。正規のBearer、Slack/Google provider、cookie、internal API key、`bbsvc_` service tokenの経路は維持する。

## 受け入れ条件

- [x] `BRAINBASE_TEST_MODE=true`でも、自己申告の`x-brainbase-*`／`x-*` headerだけで保護routeを通過せず、401になる。
- [x] 検証済みBearer、Slack provider、Google provider、session cookie、internal API key、`bbsvc_` service token、OPTIONSの既存契約を維持する。
- [x] `BRAINBASE_TEST_MODE`自体と、SNS・E2Eなど別用途のテスト経路は変更しない。
- [x] 新規setupが退役済みの`ALLOW_INSECURE_SSOT_HEADERS`を生成・launchdへ注入しない。
- [x] mesh、Info SSOT、Companion Taskなどの明示拒否側防御コードと、header spoofingの負テストは変更しない。

## スコープ

対象は共有`server/middleware/auth.js`のheader認証分岐、専用validation helper、正のmiddleware fixture、setupの死んだ設定だけとする。`run-receipts`、`external-runner`、`companion`などの下流`authSource`分岐と文書は、到達性を別途確認する後続単位とする。

## 検証

- `tests/server/middleware/auth.test.js`で非本番フラグ下のheader-onlyをRed/Greenで固定し、正規認証fixtureを再実行する。
- 対象テスト、`npm run typecheck`、lint、`git diff --check`を実行する。
- Graphifyは対象ファイルを軽量参照する。ただしGraphifyのpartial/unknownは影響なしの証明に使わず、直接参照とテストで補完する。

実施結果（2026-09-20、独立レビュー前）:

- middleware/validation対象: 2 files / 13 tests passed。
- auth関連route回帰: 7 files / 120 tests passed。
- `volta run --node 22.23.2 npm run typecheck`、`npm run lint`、`bash -n scripts/setup.sh`、`git diff --check` passed。
- 変更後Graphifyは`status=partial`、`freshness=unknown`、`impact=unknown`、`invalid_edges=false`。対象コード3ファイルはmatched、Story/Spec/setup.shはunmatched。Graphify単独で影響なしとは判定していない。
- `tests/server/routes/mesh-routes.test.js`の`ALLOW_INSECURE_SSOT_HEADERS` stubは旧header成功経路を使わず、role headerのみが401になる拒否テストの入力として維持した。

## 未確認

外部mount・別checkout・実際の非本番環境に注入される環境変数は、この変更では確認しない。productionの認証readbackや設定変更も対象外とする。
