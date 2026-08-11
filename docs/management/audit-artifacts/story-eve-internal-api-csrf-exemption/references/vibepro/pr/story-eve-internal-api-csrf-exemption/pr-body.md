## 判断
- このPRで判断すること: 本番internal API key経路のCSRF除外 を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-eve-internal-api-csrf-exemption - 本番internal API key経路のCSRF除外
- 正本: [docs/stories/story-eve-internal-api-csrf-exemption.md](docs/stories/story-eve-internal-api-csrf-exemption.md)
- 変更範囲: 7 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/stories/story-eve-internal-api-csrf-exemption.md](docs/stories/story-eve-internal-api-csrf-exemption.md), [docs/architecture/ADR-eve-internal-api-csrf-exemption.md](docs/architecture/ADR-eve-internal-api-csrf-exemption.md), [docs/specs/story-eve-internal-api-csrf-exemption.md](docs/specs/story-eve-internal-api-csrf-exemption.md)
- 実装: server/middleware/csrf.js
- テスト: [tests/e2e/story-eve-internal-api-csrf-exemption-contract.spec.ts](tests/e2e/story-eve-internal-api-csrf-exemption-contract.spec.ts), [tests/unit/csrf-internal-api-key-exempt.test.js](tests/unit/csrf-internal-api-key-exempt.test.js)

## 経緯
- 要求: 本番internal API key経路のCSRF除外
- 発生経緯: Eve meeting候補の限定backfillをLightsail本番で実行したところ、`x-internal-api-key` を付けたworkflow APIのPOSTが `requireAuth` に到達する前にCSRF middlewareから403を返された。internal API keyはserver-to-server認証として既に `requireAuth` が受理する一方、ブラウザ用CSRF tokenを取得できないため、認証契約とmiddleware順序が食い違っている。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/stories/story-eve-internal-api-csrf-exemption.md](docs/stories/story-eve-internal-api-csrf-exemption.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 5 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: server/middleware/csrf.js
- テスト差分: [tests/e2e/story-eve-internal-api-csrf-exemption-contract.spec.ts](tests/e2e/story-eve-internal-api-csrf-exemption-contract.spec.ts), [tests/unit/csrf-internal-api-key-exempt.test.js](tests/unit/csrf-internal-api-key-exempt.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/artifacts/story-eve-internal-api-csrf-exemption/typecheck.json](.vibepro/artifacts/story-eve-internal-api-csrf-exemption/typecheck.json)
- [x] Unit Gate - 7/7 pass; invalid, missing, multi-value, and unset-secret requests fail closed; evidence: [.vibepro/artifacts/story-eve-internal-api-csrf-exemption/unit.json](.vibepro/artifacts/story-eve-internal-api-csrf-exemption/unit.json) / gate: passed / evidence: [.vibepro/artifacts/story-eve-internal-api-csrf-exemption/unit.json](.vibepro/artifacts/story-eve-internal-api-csrf-exemption/unit.json)
- [x] Integration Gate - Imported CI evidence for Require Graphify Impact Review (SUCCESS) at HEAD d7b7e9e76461; evidence: [.vibepro/pr/story-eve-internal-api-csrf-exemption/ci-evidence/Require_Graphify_Impact_Review.json](.vibepro/pr/story-eve-internal-api-csrf-exemption/ci-evidence/Require_Graphify_Impact_Review.json) / gate: passed / evidence: [.vibepro/pr/story-eve-internal-api-csrf-exemption/ci-evidence/Require_Graphify_Impact_Review.json](.vibepro/pr/story-eve-internal-api-csrf-exemption/ci-evidence/Require_Graphify_Impact_Review.json)
- [x] E2E Gate - Production middleware chain and AC-001 through AC-004: 4/4 pass; evidence: [.vibepro/artifacts/story-eve-internal-api-csrf-exemption/e2e.json](.vibepro/artifacts/story-eve-internal-api-csrf-exemption/e2e.json) / gate: passed / evidence: [.vibepro/artifacts/story-eve-internal-api-csrf-exemption/e2e.json](.vibepro/artifacts/story-eve-internal-api-csrf-exemption/e2e.json)
- 最終E2E: pass: Production middleware chain and AC-001 through AC-004: 4/4 pass（[.vibepro/artifacts/story-eve-internal-api-csrf-exemption/e2e.json](.vibepro/artifacts/story-eve-internal-api-csrf-exemption/e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-eve-internal-api-csrf-exemption/](.vibepro/pr/story-eve-internal-api-csrf-exemption/)
- PR準備: [.vibepro/pr/story-eve-internal-api-csrf-exemption/pr-prepare.json](.vibepro/pr/story-eve-internal-api-csrf-exemption/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-eve-internal-api-csrf-exemption/decision-index.json](.vibepro/pr/story-eve-internal-api-csrf-exemption/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 670f7b40a64a detached/package dirty (story=story-eve-internal-api-csrf-exemption)
