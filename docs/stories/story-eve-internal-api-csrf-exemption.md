---
story_id: story-eve-internal-api-csrf-exemption
title: 本番internal API key経路のCSRF除外
status: active
created_at: 2026-07-13
updated_at: 2026-07-13
period: 2026-W29
responsibility_authority_docs:
  - path: docs/responsibility-authority/eve-internal-api-csrf-exemption.json
---

# 本番internal API key経路のCSRF除外

## 背景

Eve meeting候補の限定backfillをLightsail本番で実行したところ、`x-internal-api-key` を付けたworkflow APIのPOSTが `requireAuth` に到達する前にCSRF middlewareから403を返された。internal API keyはserver-to-server認証として既に `requireAuth` が受理する一方、ブラウザ用CSRF tokenを取得できないため、認証契約とmiddleware順序が食い違っている。

## 誰のため

Brainbaseのserver-to-server workflowを運用し、会議候補の自動取得を止めずに監査可能な形で再実行する運用者のため。

## 成功指標

対象meeting sourceのexact-run backfillがCSRF 403を返さずdispatchされること。誤キー・欠落キーの拒否率は100%を維持する。

## 受け入れシナリオ

### S-001: 正しいinternal API key

- Given: `INTERNAL_API_SECRET` が設定され、同じ値の `x-internal-api-key` を持つ本番POSTである
- When: CSRF middlewareと`requireAuth`を順に通る
- Then: CSRFで拒否せず、internal serviceとして認証する

### S-002: 誤った、または欠けたinternal API key

- Given: headerが欠けている、値が異なる、またはserver secretが未設定である
- When: CSRF middlewareを通る
- Then: 従来どおり403で拒否し、認証済みinternal requestとして扱わない

### S-003: ブラウザ由来の変更リクエスト

- Given: internal API keyも有効なCSRF tokenもない本番POSTである
- When: CSRF middlewareを通る
- Then: 従来どおり403で拒否する

### S-004: exact-run workflow経路

- Given: 対象meeting sourceのbackfillが正しいinternal API keyを付けて`POST /api/workflows/control/loop-intents/:loopIntentId/eve-session`を呼ぶ
- When: 本番と同じ順序でCSRF middlewareと`requireAuth`を通る
- Then: CSRF 403では止まらず、internal serviceとしてworkflow routeへ到達する

## Acceptance Criteria

- [ ] AC-001 / ac:1: 設定済みsecretと完全一致するinternal API keyだけがCSRFを通過し、後段の`requireAuth`でinternal serviceとして認証される
- [ ] AC-002 / ac:2: 誤キー、header欠落、server secret未設定はいずれもCSRFで403になる
- [ ] AC-003 / ac:3: internal keyを持たないブラウザ経路のCSRF検証は変更しない
- [ ] AC-004 / ac:4: exact-runが利用するworkflow POSTが本番middleware順序でCSRF 403なくrouteへ到達する

## Done Evidence

- Unit: CSRF middleware単体で正キー、誤キー、欠落、server secret未設定を検証する
- Integration: 既存workflow/companion route testで認証・ルーティング契約の回帰がないことを検証する
- E2E: Story固有Playwrightで本番順序のCSRFと`requireAuth`を連結し、正キーだけがinternal serviceとして認証されることを再生する
- Static: typecheckと変更ファイルのESLintを通す
- Production: Lightsailへmerge commitを反映し、対象runに限定したdry-runとexecuteで候補生成を確認する

## Failure Modes

- FM-001: `INTERNAL_API_SECRET` が未設定ならinternal exemptionを無効にし、CSRF tokenなしのPOSTを403で拒否する。
- FM-002: `x-internal-api-key` が欠落、不一致、または複数値ならtiming-safe比較の対象にせず403で拒否する。
- FM-003: 正しいinternal keyでCSRFを通過しても、後段の`requireAuth`を省略せずroute authorityをCSRF層へ移さない。
- FM-004: internal keyを持たないbrowser requestは従来のCSRF token検証を維持し、workflow path単位では除外しない。

## Engineering Judgment Spine

current_reality: internal API keyは`requireAuth`がserver-to-server認証として受理するが、前段のCSRF middlewareがブラウザ用tokenなしの本番POSTを403にしている。

failure_modes: secret未設定、header欠落、値不一致、複数値header、ブラウザ由来のtokenなしPOSTをfail-closedで拒否し、正キーでも後段の`requireAuth`を必須とする。path単位の無条件除外やCSRF層での権限付与は行わない。

done_evidence: Unitで全negative path、Story E2Eで本番middleware順序とAC-001からAC-004、Integrationで既存workflow route、Staticで構文・型・lint、本番で対象run限定のdry-runとexecuteを確認する。

release_or_operation: merge commitをLightsailに反映し、healthとschedulerを確認してから対象meeting sourceのexact-runだけを実行する。失敗時は直前deploy branchへ戻してserviceを再起動する。

## Release / Rollback

DB migrationはない。Brainbase consumerをLightsailへ反映して対象runだけを再実行する。問題時は直前のdeploy branchへ戻して`brainbase-ssot.service`を再起動し、正本ではmerge commitをrevertする。

本番release verificationでは対象meeting sourceのdry-runが1件だけであることを確認してからexecuteし、CSRF 403が解消してdispatch runが作られることを記録する。

## スコープ外

- browser session向けCSRF tokenの仕組み変更
- internal API key認証方式そのものの置換
- 対象run以外のmeeting source一括backfill
