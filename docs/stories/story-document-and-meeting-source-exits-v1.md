---
story_id: story-document-and-meeting-source-exits-v1
title: 文書の書き込み・知識の取り込みの検証・会議ソースのカタログをOSSの公開packageの出口に出す
status: in_progress
created_at: 2026-10-10
implementation_started: true
owner_repository: brainbase
depends_on:
  - story-knowledge-resolution-service-exit-v1
---

# 文書の書き込み・知識の取り込みの検証・会議ソースのカタログをOSSの公開packageの出口に出す

## 利用者成果

組織版に知識文書と会議の自動化の部品を移す開発者として、それらが依存する共通の部品を、unsonのファイルではなくOSSのnpmの公開版から読みたい。組織版の移設計画では、段2の `organization-knowledge-documents` と段4の `organization-meeting-automation` がこれらの部品に依存するため、出口がないと組織版へ移せない。

## 背景

- 所有台帳（brainbase-unson `docs/contracts/repository-ownership.json`）で、次の3項目は移設先がOSS（`brainbase`）で、`migration_pending` のまま。
  - `canonical-document-writer-contract`（`server/services/canonical-document-writer-adapter.js`）：チームの文書を所有repoへ書き込むとき、入力の検査・CASと冪等の値の受け渡し・書き込み後の読み戻しの照合をする。書き込みの実体（provider）は呼び出し側が渡す。
  - `knowledge-capture-preview-adapter`（`server/services/knowledge-capture-preview-adapter.js`）：知識の取り込みの提案と、下書きの回答をAIの部品から受け取るときの検証。根拠・版・読み戻しの無い結果を成功にしない。
  - `meeting-source-sync` のうち、会議ソースのカタログ（`server/services/meeting-source/meeting-source-integration-catalog.js`）：Tactiq・Plaud.ai の会議ソースの一覧と、integrations.sh での公開面の確認。
- 3つとも、Node.jsの標準モジュール以外に依存しない。

## 受入条件

- [x] AC-01: `@unson/brainbase-mcp/canonical-document-writer`、`@unson/brainbase-mcp/knowledge-capture-preview`、`@unson/brainbase-mcp/meeting-source-integration-catalog` から、それぞれの部品を取り込める。
- [x] AC-02: unsonの部品を処理を変えずに移す。エラーの型・コード・HTTPの状態、正規化の結果、カタログの中身と確認のURLが同じ。
- [x] AC-03: unsonの文書の書き込みのテストを同じ内容でOSSに置いて通す。直接のテストが無い2部品は、unsonの呼び出し側が頼っている振る舞い（根拠・版・読み戻しの検証の失敗、許可された候補の外の引用の拒否、未知のproviderの404、確認の失敗時の結果）をテストで固定する。
- [x] AC-04: 公開の出口（`package.json` の `exports`）から、ビルド後の成果物として読み込める。
- [ ] AC-05: npmの公開版に入り、unsonの旧ファイルがこの出口の再exportになる（unson側の別PR。所有台帳の項目を `canonical` へ更新するのは、本番での読み戻しの後）。

## 範囲外

- 書き込みの実体（GitHubの所有repoへの書き込み、`github-owning-repository-document-provider`）と、知識文書のサービス・保存先。組織版の段2で移す。
- 議事録の文脈の受領（`meeting-minutes-context-receipt`）と判断の解決（`judgment-harness`）。前者は組織版の部品を読み込み、後者はrepo内のファイルを読むため、別のStoryで扱う。

## 検証

- `npx vitest run tests/canonical-document-writer.test.ts tests/knowledge-capture-preview.test.ts tests/meeting-source-integration-catalog.test.ts`
- `npm run build`（strictの型検査）
- `npm run docs:check`
