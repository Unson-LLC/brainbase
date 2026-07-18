---
title: Playwright Worktree Discovery Boundary
status: accepted
date: 2026-07-17
story_id: story-playwright-worktree-discovery-boundary
---

# Playwright Worktree Discovery Boundary

## Problem

`testDir: '.'`は`tests/e2e/`と`e2e/`の両方を扱うために必要だが、正本checkout内に配置された別Git checkoutも探索する。別checkoutは独立した依存グラフと変更状態を持つため、正本テストrunへ混ぜてはならない。

## Decision

Playwrightのcollection boundaryを`playwright.config.js`で明示する。

- `testDir`と既存`testMatch`は維持する
- `testIgnore`で`**/.worktrees/**`を除外する
- `testIgnore`で`**/.codex-worktrees/**`を除外する
- port、server起動、project、reporter設定には触れない

## Boundary Semantics

正本checkoutのルートはテスト探索空間である。`.worktrees/`と`.codex-worktrees/`は正本の子ディレクトリに見えても、意味的には独立したrepository workspaceであり、親のtest runから隔離する。

## Alternatives Rejected

- `testDir: 'tests/e2e'`: `e2e/`の正規テストを失う
- worktree削除: 並行作業を破壊し、再発を防がない
- `.gitignore`依存: Git追跡対象とPlaywright収集対象は別契約である
- `node_modules`だけをignore: 別checkoutのテスト本体は依然収集される

## Rollback

`testIgnore`追加だけをrevertする。データ移行やruntime変更はない。
