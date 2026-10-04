---
story_id: story-world-kind-terms-from-graph-v1
title: 世界の分類の名前と意味を、組織Graphの用語から読む
status: in_progress
created_at: 2026-10-04
implementation_started: true
owner_repository: brainbase
depends_on: ["story-world-generic-graph-v1"]
---

# 世界の分類の名前と意味を、組織Graphの用語から読む

## 利用者成果

組織のGraphを読んでいるなら、誰の手元でも、世界の分類が組織の決めた名前（例「プロダクト」）で出て、その意味も確かめられる。語彙ファイルが無い人にも `product` のような値のまま出ない。

## 背景

プロジェクトの種類欄（`kind`）の値の意味は、2026-10-04 に組織Graphの用語（`glossary_term`、`payload.vocabulary = { field: "project.kind", value }`）として登録された（`gls_project_kind_*`）。分類の名前と意味は組織の言葉なので正本はGraph、色と建物の形は見せ方なのでホストの語彙ファイルに残す。

## 受入条件

- [x] AC-01: C1 は組織Graphの用語のうち、有効で `payload.vocabulary.field` と `value` を持つものを読み、名前（`label`、無ければ `term`、無ければ値）と意味（`definition`）を取り出す。
- [x] AC-02: 用語の読み取りに失敗しても、組織Graphの他の読み取り（画面・世界）は止めない。世界は「用語を読めない」ことを示し、語彙ファイルか値のままで描く。
- [x] AC-03: 世界の分類の名前は、Graphの用語 → 語彙ファイル → 値の順で決める。どこから来た名前か（`graph`・`config`・`value`）と意味を応答に含める。色と建物の形は今までどおり語彙ファイルから。
- [x] AC-04: 事業の右欄に、分類の名前と意味を出す。

## 対象外

状態（`status`）の語彙をGraphへ移すこと、手元のGraph（OSS Personal）に用語の種類を足すこと、種類欄の `product` を product ノードから導くこと。

## 検証

`tests/organization-graph-web.test.ts`（用語の抽出と失敗の扱い）、`tests/world-extension.test.ts`（名前の優先順位と出どころ）。実データの組織Graphで、語彙ファイル無しでも「プロダクト」「顧客案件」が出ること。
