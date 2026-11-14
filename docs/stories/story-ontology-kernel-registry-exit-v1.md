---
story_id: story-ontology-kernel-registry-exit-v1
title: Graphのオントロジー（kernel・registry・publication・release-trust）をOSSの公開packageの出口に出す
status: in_progress
created_at: 2026-10-12
implementation_started: true
owner_repository: brainbase
depends_on: [story-graph-maintenance-memory-scope-exit-v1]
---

# Graphのオントロジー（kernel・registry・publication・release-trust）をOSSの公開packageの出口に出す

## 利用者成果

組織版にGraphの保存先（所有台帳の `organization-graph-store`）を移す開発者として、その本体が読むオントロジーの部品を、unsonのファイルではなくOSSのnpmの公開版から読みたい。台帳が定める前提（オントロジー・Graphの保守エンジン・埋め込み）のうち、これが最後の1つ。

## 背景

- unsonの `server/services/ontology-kernel.js`・`ontology-registry.js`・`ontology-publication.js`・`ontology-release-trust.js`（台帳 `ontology-kernel-and-registry`、移設先 brainbase）。
- kernel は型と関係の定義の検査、決定の推論、影響の見積もり、版の候補の組み立てを担う。registry は設定フォルダの `index.json` と各版のマニフェストを読み、署名つき公開の受領証を検証してから版を解決する。
- OSSにある `ontology`・`ontology-foundation`・`ontology-migration`・`ontology-ssot` とはシンボルが重ならない。
- registry は渡された `rootDir`（既定は作業ディレクトリ）と `configDir`（既定 `config/ontology`）から読み、unsonに固有の値は持たない。unsonの署名つきの版のデータ（`config/ontology`）は組織の名前を含むので、OSSには持ち込まない。

## 受入条件

- [x] AC-01: `@unson/brainbase-mcp/ontology-kernel`・`ontology-registry`・`ontology-publication`・`ontology-release-trust` から、unsonと同じ名前の出口（`OntologyKernel`・`OntologyError`・`DECISION_STATUS_RULE_ID`・`buildOntologyReleaseCandidate`・`OntologyRegistry`・`canonicalJson`・`sha256`・`verifyPublicationReceipt` など）を取り込める。
- [x] AC-02: 処理はunsonの実装と同じ。変えるのは型の注記だけ。
- [x] AC-03: unsonの実装と同じ入力に同じ出力（例外を含む）を返すことを、両方を並べた突き合わせで確かめる。unsonの署名つきの実データでも、unsonのテスト3本（kernel・registry・publication）をOSSの部品に向けて実行して通す。データはOSSに持ち込まない。
- [x] AC-04: OSSには合成のマニフェストと自己署名の受領証で振る舞いのテストを置く。
- [x] AC-05: 公開の出口（`package.json` の `exports`）から、ビルド後の成果物として読み込める。
- [ ] AC-06: npmの公開版に入る（公開は佐藤さんの承認後）。

## 範囲外

- unsonがこの出口を読む形への切り替えと、Graphの保存先の本体の組織版への移設。公開の後、別PRで行う。

## 検証

- `npx vitest run tests/ontology-kernel-registry.test.ts`
- `npm run build`（strictの型検査）
- `npm run docs:check`
