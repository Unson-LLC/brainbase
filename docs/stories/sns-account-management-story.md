---
story_id: str.brainbase.sns-account-management
title: SNS Account Management
status: active
date: 2026-05-15
reason: "Account foundation、integration_accounts、X provider、SNS Growth Cockpitの既存境界に接続するStoryであり、新しい永続化モデルや外部連携方式を決めないため新規ADRは不要。"
related_specs:
  - SPEC-sns-account-management
related_adrs:
  - ADR-008
related_stories:
  - story-sns-posting-cockpit
  - str.brainbase.sns-scheduled-publisher
---

# Story: SNS Account Management

## User Story

brainbaseでSNS運用を回すさとけいとして、
X投稿とmetrics取得に使うアカウントの状態、既定用途、credential readiness、healthをSNS Growth Cockpitから確認・更新したい。
そうすれば、DB直操作やターミナル確認に戻らず、投稿運用の画面から「今このアカウントで投稿できるか」を判断できる。

## Context

SNS Posting Ledger、手動投稿、予約投稿runner、metrics pollerは `integration_accounts` の `acc_x_sato` に依存している。
しかし現在はアカウント登録や既定用途の確認がDB/環境変数/スクリプトに分散しており、SNS Growth UIからは「どのX accountを使っているか」「token参照が存在するか」「healthが通るか」が見えない。

このStoryは、SNS投稿の本文生成や予約カレンダーではなく、投稿実行に必要な account operational layer を作る。

## Business Context

狙いは「X APIを触る設定画面」ではない。
Brainbase上でSNS運用を閉ループにするとき、公開投稿・metrics取得・学習戻しの前提になるアカウント状態が見えないと、運用者は毎回ターミナルやX管理画面へ戻る必要がある。

Account ManagementをSNS Growth Cockpitの薄い操作面に入れることで、日次運用の判断は以下の順になる。

1. 今日レビューすべき投稿を見る。
2. X accountがconnectedで、posting default/metrics defaultが設定されていることを確認する。
3. 必要ならHealth Checkを押してcredentialとrate limitを確認する。
4. 投稿・予約・metrics取得・学習戻しへ進む。

## Architecture Decision

ADR-unnecessary decision: approved.

このStoryは既存の `integration_accounts`、`AccountService`、`ProviderRegistry` / X Provider、`SNS Growth Cockpit` に接続する実装であり、新しいDB境界や新しいsecret管理方式を作らない。

Credential secretはInfisicalまたはruntime env projectionに残し、DB/API/UIは `credential_ref` の provider/path/env key と env presence だけを扱う。

## Scope

- SNS Growth APIからvisible X accountsを返す。
- API responseではcredential secretを返さない。
- SNS posting用途とSNS metrics用途のdefault accountをUIに表示する。
- SNS posting用途とSNS metrics用途のdefault accountをUIから更新できる。
- X Provider経由でHealth Checkとrate limit statusを取得できる。
- SNS Growth CockpitにAccount Stripを追加し、投稿カレンダー・詳細ペインと同じ運用面で確認できる。
- worktree/test modeではin-memory account repositoryで既存テストを壊さない。

## Non-goals

- このStoryではOAuth callbackの本番接続を完了条件にしない。
- このStoryではInfisical secretの値をUIやAPIに出さない。
- このStoryでは複数ユーザー向けの汎用settings UIを作らない。
- このStoryでは新しいSNS投稿本文を生成しない。
- このStoryではGraph SSOTへaccount operational stateを書き込まない。

## Acceptance Criteria

- [ ] AC-1: `GET /api/sns-growth/accounts` は、現在actorが見られるX accountだけを返す。
- [ ] AC-2: API/UIは `credential_ref` の provider/path/env/env_present だけを返し、access tokenやsecret値を返さない。
- [ ] AC-3: SNS Growth CockpitはX accountのconnected状態、external handle、posting default、metrics default、credential readinessを表示する。
- [ ] AC-4: UIのHealth Check操作はX Provider経由でhealthとrate limitを取得し、結果を同じAccount Stripに表示する。
- [ ] AC-5: UIからposting defaultまたはmetrics defaultを更新すると、`AccountService.setDefault` を通り、audit eventが残る。
- [ ] AC-6: 既存の投稿レビュー、カレンダー、詳細ペイン、手動投稿、metrics記録、削除済み管理の動線は壊れない。

## Verification

- Unit/API: `tests/server/routes/sns-growth.test.js`
- Provider: `tests/sns/account-management/**/*.test.js`, `tests/sns/providers/x-api-client.test.js`
- UI: `tests/ui/views/sns-growth-cockpit-view.test.js`
- E2E regression: `tests/e2e/sns-growth-cockpit.spec.js`
