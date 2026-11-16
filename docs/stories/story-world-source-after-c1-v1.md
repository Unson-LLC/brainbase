---
story_id: story-world-source-after-c1-v1
title: 組織のGraphを読まないPersonal Webで、世界の出典を「手元のGraph」と正しく出す
status: in_progress
created_at: 2026-10-05
implementation_started: true
owner_repository: brainbase
depends_on: ["story-world-visual-quality-v1"]
---

# 組織のGraphを読まないPersonal Webで、世界の出典を「手元のGraph」と正しく出す

## 利用者成果

Personal Webを開いた本人として、世界がどのGraphを描いているのかを、画面上部の出典で正しく知りたい。

## 背景

2026-10-05、組織版にも世界が載り、佐藤さんが確認したので、常駐のPersonal Web（31080）は組織のGraphを読む検証用の経路（C1）をやめ、手元のGraphだけを描くようにした。ところが世界の出典は「組織のGraph・判断journal」に固定されていた。

## 受入条件

- [x] AC-01: 組織のGraphにつないでいないとき、世界の出典は「手元のGraph・判断journal（読み取りのみ）」。
- [x] AC-02: 組織のGraphにつないでいるとき（C1）、世界の出典は「組織のGraph・判断journal（読み取りのみ）」。「プロジェクトと関係者」「情報と関係」の扱いは変えない。

## 検証

- `tests/ui/local-web-shell.test.mjs` で出典の選び方を確かめる。世界の既定の出典を元に戻すとテストが落ちることも確かめる。
