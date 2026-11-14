---
story_id: story-shell-nav-area-tabs-v1
title: 左側は6つの領域だけにし、領域の中の画面は本文の上のタブで切り替える
status: in_progress
created_at: 2026-10-16
implementation_started: true
owner_repository: brainbase
---

# 左側は6つの領域だけにし、領域の中の画面は本文の上のタブで切り替える

## 利用者成果

Brainbase の Web を開く本人として、左側を読まずに、毎日使う画面へ迷わず着きたい。2026-10-16、佐藤さんは組織版の左メニューについて「項目が多く、世界以外は全部読もうという気にならない」と述べた。見出しで束ねた段階1のあとも、項目が全部並んでいたため。

## 背景

- brainbase-project の前提台帳（`docs/architecture/oss-personal-web-ux-premises.md`）D10 の段階2。2026-10-16 に案Bとして具体化した（brainbase-project #111）。
- 段階1は [story-shell-nav-six-areas-v1](./story-shell-nav-six-areas-v1.md)。
- 部品は OSS の共通UIに作り、OSS Personal と組織版が同じ部品を使う（D8・P16）。組織版の組み込みと、組織版の「プロジェクトを選ぶ」一覧の移設は、組織版の Story で行う。

## 受入条件

- [ ] AC-01: 共通部品 `ui/area-nav.js` が、領域ごとのリンク（左側）と、今の領域の画面のタブ（本文の上）を作る。どちらも画面へのリンクで、画面のアドレスは変えない。
- [ ] AC-02: 領域のリンクは、その領域で前回開いた画面を開く。前回が無い・前回の画面が今は無いときは、領域の既定の画面、それも無ければ領域の最初の画面を開く。外部へのリンク（別のタブで開くもの）は前回にも既定にもならない。
- [ ] AC-03: 前回の画面は閲覧者のブラウザに覚える。保存が読めない・書けないときも例外を出さず、AC-02 の既定で開く。
- [ ] AC-04: 画面が1つの領域では、タブを出さない。
- [ ] AC-05: 画面に件数を付けられる。件数はタブに出す。待っているものの件数は、領域のリンクにも合計を出す。待っているものでない件数は領域のリンクに出さない。
- [ ] AC-06: 画面を隠せる（見られる人にだけ出す画面のため）。隠した画面はタブにも、領域の行き先にも使わない。画面がすべて隠れた領域は左側に出さない。
- [ ] AC-07: OSS Personal の左側は、領域ごとに1行（世界の拡張があれば世界・目的と現状・仕事・成果・情報と関係・設定）になり、見出しの区画は無くなる。仕事の既定はプロジェクトと関係者、情報と関係の既定は情報と関係、設定の既定は情報の種類とつながり方。領域を持たない拡張の画面は、これまでどおり先頭または末尾に1行ずつ並ぶ。
- [ ] AC-08: OSS Personal の画面ID（`#value-proofs` など）、初期画面、`LOCAL_WEB_SCREENS` の並びは変えない。

## Spec

- 振る舞いは `tests/ui/area-nav.test.mjs`（部品）と `tests/ui/local-web-shell.test.mjs`（OSS Personal の組み込み）で固定する。
- 部品は DOM を作るだけで、画面の表示・読み込みは呼び出し側が持つ。`show(screenId)` で今の画面を知らせ、`onSelect(screenId)` で選ばれた画面を返す。

## 範囲外

- 組織版への組み込みと、「プロジェクトを選ぶ」一覧の移設（組織版の Story）。
- 正本への保存（前回の画面は個人の表示の好みで、組織の事実ではない）。

## 検証

- `tests/ui/area-nav.test.mjs`、`tests/ui/local-web-shell.test.mjs`、`tests/ui-package-contract.test.ts`、`tests/local-web-host.test.ts`。
