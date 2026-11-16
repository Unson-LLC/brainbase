---
story_id: story-remove-c1-organization-graph-v1
title: Personal Webが組織のGraphを読む検証用の経路（C1）をOSSから外す
status: in_progress
created_at: 2026-10-05
implementation_started: true
owner_repository: brainbase
depends_on: ["story-world-source-after-c1-v1"]
---

# Personal Webが組織のGraphを読む検証用の経路（C1）をOSSから外す

## 利用者成果

OSSのBrainbaseを使う人として、Personal Webが本人のトークンで組織のサーバーへ取りに行く経路を持たず、手元のGraphだけを描くと分かっていたい。組織のGraphは組織版で見る。

## 背景

C1（2026-09-24採用）は「検証の間、Personal Webが組織のGraphを読み取り専用で使う」代用だった。2026-10-05、組織版にも世界が同じ部品で載り、佐藤さんが確認したので、常駐のPersonal WebからC1を外し、佐藤さんがOSSからもコードを消すと決めた。OSSは組織のサービスに頼らない決まり（CLAUDE.md）に戻す。

## 受入条件

- [x] AC-01: `web:serve` から `--organization-graph` と `--organization-web` を外す。渡されたら黙って無視せず、組織版で見るよう案内して失敗する。
- [x] AC-02: 本人の `~/.brainbase/tokens.json` で組織のサーバーを読むコード（`createOrganizationGraphSource`、`readOrganizationAccess`）と、ホストの組織モード（状態の `organization_graph`、Graphの読み替え `readGraph`、訂正の403、メモリ上の読み手 `openInMemoryGraph`）を消す。
- [x] AC-03: Personal Webの画面から、組織のGraphの出典表示・組織版へのリンク・訂正の案内・サイドバーの「組織のGraph」を消す。世界の右欄の組織版へのリンクも消す。
- [x] AC-04: 組織版が使うものは残す：記録をGraph v2に写す `projectOrganizationGraph`・`projectVocabularyTerms`、`projectOrganizationWorld`、世界の画面が組織版で `organization-judgments` を読む分岐、`readOnlyNote` の拡張点。以前からある組織アダプタ（`organization-graph.ts`、Graphの束・移行・本人専用領域の検索）も変えない。
- [x] AC-05: 公開している出口（`openInMemoryGraph`、`readOrganizationJudgments` など）を消すので、版は 0.16.0 にする。

## 検証

- 型検査と全テスト。外したフラグを渡すと失敗する試験を足し、守りを外すと試験が落ちることを確かめる。
- 組織版の試験一式を、この版のパッケージで流して壊れないことを確かめる。
