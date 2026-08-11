---
story_id: story-playwright-worktree-discovery-boundary
title: Playwrightの探索対象をcanonical E2Eへ限定する
status: active
created_at: 2026-07-17
updated_at: 2026-07-17
period: 2026-W29
---

# Playwrightの探索対象をcanonical E2Eへ限定する

## 背景

Brainbaseの正本checkout直下には、並行作業用の`.worktrees/`と`.codex-worktrees/`が存在する。現在のPlaywright設定は`testDir: '.'`から再帰探索するため、これら別checkoutのE2E、Vitest、`node_modules`まで読み込み、依存関係の二重ロードや不足を起こして正本テストを0件として終了する。

## 誰のため

正本checkoutからBrainbaseのE2Eを実行し、別セッションのworktree状態に左右されない検証結果を必要とする開発者とCIのため。

## 成功指標

`playwright test --list`が別worktreeのファイルを一切ロードせず、正本のE2Eだけを1件以上列挙する。

## 受け入れシナリオ

### S-001: 正本のE2E

- Given: 正本checkoutに`tests/e2e/**/*.spec.js`または`e2e/**/*.spec.js`がある
- When: Playwrightがテストを探索する
- Then: 対象テストを従来どおり列挙する

### S-002: Git worktree配下のE2E

- Given: `.worktrees/<name>/`配下に別checkoutとテスト・依存関係がある
- When: 正本checkoutからPlaywrightがテストを探索する
- Then: `.worktrees/`配下を収集・importしない

### S-003: Codex worktree配下のE2E

- Given: `.codex-worktrees/<name>/`配下に別checkoutとテスト・依存関係がある
- When: 正本checkoutからPlaywrightがテストを探索する
- Then: `.codex-worktrees/`配下を収集・importしない

## Acceptance Criteria

- [x] AC-001 / ac:1: 正本の`tests/e2e/**/*.spec|test.@(js|ts)`と`e2e/**/*.spec.@(js|ts)`は探索対象に残る
- [x] AC-002 / ac:2: `.worktrees/**`はPlaywrightの探索対象から除外される
- [x] AC-003 / ac:3: `.codex-worktrees/**`はPlaywrightの探索対象から除外される
- [x] AC-004 / ac:4: 正本checkout相当の実行で別worktree由来の二重ロード・依存不足が起きず、正本テストが1件以上列挙される
- [x] AC-005 / ac:5: port、webServer、browser project、reporterの既存契約は変更しない

## Done Evidence

- Unit: Playwright設定の対象patternとworktree除外patternを契約テストで固定する
- E2E: Story固有Playwright内で正本specと2種類の擬似worktree specを生成し、実際のcollectorが正本1件だけを列挙することを確認する。加えて全探索の`playwright test --list`が正本テストを1件以上列挙し、内部worktree由来のエラーが0件であることを確認する
- Static: 変更ファイルの構文とdiffを検証する

## Failure Modes

- FM-001: `testDir`を`tests/e2e`だけへ狭めると、正規の`e2e/`配下が検証から脱落する。
- FM-002: `.gitignore`だけではPlaywrightの探索境界にならず、別checkoutのファイルをimportし得る。
- FM-003: worktree自体を削除して症状を消すと、並行開発を壊し、設定の境界不備が残る。

## Engineering Judgment Spine

current_reality: Playwrightはリポジトリルートから複数の正規E2E配置を探索する必要がある一方、ルート内の別checkoutも同じ再帰探索に混入している。

failure_modes: `testDir`を狭めて正規E2Eを失う、`.gitignore`へ誤依存する、別checkoutをimportして二重ロード・依存不足になる失敗を、既知の内部checkout rootのfail-closed除外と、import時にthrowする擬似worktree回帰試験で検知する。

done_evidence: 最終HEADに固定したUnit 3件、import時にthrowする擬似worktree 2種を含むStory E2E 3件、全collector 641件・107ファイル・nested path 0件、diffとJavaScript構文エラー0件のJSON・コマンド証跡でAC-001からAC-005を確認する。

release_or_operation: 設定のみの変更としてdevelopへmergeする。問題時は当該commitをrevertし、既存のテスト探索契約へ戻す。

## スコープ外

- 既存worktreeの削除・移設
- E2Eディレクトリ全体の統合
- Playwrightのversion更新
