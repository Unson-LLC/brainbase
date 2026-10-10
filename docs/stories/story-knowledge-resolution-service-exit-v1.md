---
story_id: story-knowledge-resolution-service-exit-v1
title: 知識の置き場の決定（knowledge-resolution-service）をOSSの公開packageの出口に出す
status: in_progress
created_at: 2026-10-10
implementation_started: true
owner_repository: brainbase
depends_on: []
---

# 知識の置き場の決定（knowledge-resolution-service）をOSSの公開packageの出口に出す

## 利用者成果

組織版に会社権限の部品を移す開発者として、知識の置き場の決定を、unsonのファイルではなくOSSのnpmの公開版から読みたい。組織版の移設計画の段3（テナント分離・会社権限）では、`authority-knowledge-resolution-service` がこの部品に依存するため、出口がないと組織版へ移せない。

## 背景

- 所有台帳（brainbase-unson `docs/contracts/repository-ownership.json`）の項目 `knowledge-resolution-common` は、移設先がOSS（`brainbase`）で、`migration_pending` のまま。
- 部品は、内容の種類（`content_type`）と相手（`audience`）から、知識を探す正本（Graph・所有repo・チームのDrive・個人KG・作業場）を決めて受領書を返すだけで、外部サービスにもunsonの他のファイルにも依存しない。
- 同じ台帳で「`AppError` 待ち」とされていた `company-authority-human-approval-service` の依存は、すでに `./server-support`（0.11.0）で公開済み。

## 受入条件

- [x] AC-01: `@unson/brainbase-mcp/knowledge-resolution-service` から `KnowledgeResolutionService` を取り込める。
- [x] AC-02: unsonの部品を処理を変えずに移す。内容の種類ごとの正本・取得の能力・除外する置き場・`confidence`、未知の種類のときの `unconfirmed`・`not_searched`・`next_route`、受領書の形（`resolution_id`・`resolved_at` など）が同じ。
- [x] AC-03: unsonの部品のテスト（所有repoへの決定とWiki・個人KGの除外、4種類の決定、未知の入力、呼び出し側の受領書・repository・pathを採用しないこと、相手と種類の矛盾の拒否、必須入力と列挙の検査）を、同じ内容でOSSに置いて通す。
- [x] AC-04: 公開の出口（`package.json` の `exports`）から、ビルド後の成果物として読み込める。
- [ ] AC-05: npmの公開版に入り、unsonの `server/services/knowledge-resolution-service.js` がこの出口の再exportになる（unson側の別PR。所有台帳の項目を `canonical` へ更新するのは、本番での読み戻しの後）。

## 範囲外

- 知識の置き場を決めるAPIの経路（`server/routes/knowledge-resolution.js`）とMCPのツール。unsonと組織版の側に残す。
- 会社権限の部品（`authority-knowledge-resolution-service`）を組織版へ移すこと。この出口の公開の後、組織版の段3で行う。

## 検証

- `npx vitest run tests/knowledge-resolution-service.test.ts`
- `npm run build`（strictの型検査）
