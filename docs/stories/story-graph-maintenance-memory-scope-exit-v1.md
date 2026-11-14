---
story_id: story-graph-maintenance-memory-scope-exit-v1
title: Graphの保守エンジンと記憶の範囲の判定をOSSの公開packageの出口に出す
status: in_progress
created_at: 2026-10-12
implementation_started: true
owner_repository: brainbase
depends_on: []
---

# Graphの保守エンジンと記憶の範囲の判定をOSSの公開packageの出口に出す

## 利用者成果

組織版にGraphの保存先（所有台帳の `organization-graph-store`）を移す開発者として、その本体が読むGraphの保守エンジンと記憶の範囲の判定を、unsonのファイルではなくOSSのnpmの公開版から読みたい。台帳はこの本体を「OSSの部品（オントロジー・Graphの保守エンジン・埋め込み）がpackageに出てから移す」と定めている。埋め込みは0.27.0で出ているので、残りのうち依存のない2つを先に出す。

## 背景

- `server/services/graph-maintenance-engine.js`（台帳 `graph-maintenance-core`、移設先 brainbase）は、Graphの変更計画の組み立て・適用・スナップショットの検査とハッシュを担う。依存は `node:crypto` だけ。
- `server/services/memory-scope-policy.js`（台帳 `personal-knowledge-common-contract-and-local-runtime`、移設先 brainbase）は、記憶の記録と参照の文脈を正規化し、見てよい範囲かを判定する。依存はない。
- オントロジー（kernel・registry・publication）はファイルの読み込みと署名の検証に依存するので、次の段で扱う。

## 受入条件

- [x] AC-01: `@unson/brainbase-mcp/graph-maintenance-engine` から `GRAPH_MAINTENANCE_OPERATIONS`・`GRAPH_MAINTENANCE_MAX_OPERATIONS`・`hashGraphSnapshot`・`findIntroducedGraphValidationIssues`・`applyGraphOperations`・`buildGraphPlan`・`validateGraphSnapshot` を取り込める。
- [x] AC-02: `@unson/brainbase-mcp/memory-scope-policy` から `normalizeMemoryAccessContext`・`normalizeMemoryRecord`・`evaluateMemoryScope`・`buildScopedMemoryResult`・`filterScopedMemoryRecords` を取り込める。
- [x] AC-03: 処理はunsonの実装と同じ。変えるのは型の注記だけ。unsonの保守エンジンの単体テスト（`graph-maintenance-engine.test.js`・`graph-maintenance-shared-membership-engine.test.js`）を同じ内容で移して通す。記憶の範囲の判定には直接の単体テストがないので、振る舞いのテストを足す。
- [x] AC-04: unsonの実装と同じ入力に同じ出力（例外を含む）を返すことを、両方を並べた突き合わせで確かめる。
- [x] AC-05: 公開の出口（`package.json` の `exports`）から、ビルド後の成果物として読み込める。
- [ ] AC-06: npmの公開版に入る（公開は佐藤さんの承認後）。

## 範囲外

- オントロジー（kernel・registry・publication）の移設。次の段で行う。
- unsonがこの出口を読む形への切り替えと、Graphの保存先の本体の組織版への移設。公開の後、別PRで行う。

## 検証

- `npx vitest run tests/graph-maintenance-engine.test.ts tests/graph-maintenance-shared-membership-engine.test.ts tests/memory-scope-policy.test.ts`
- `npm run build`（strictの型検査）
- `npm run docs:check`
