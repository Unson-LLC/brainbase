---
story_id: story-shell-nav-six-areas-v1
title: Personal Web のメニューを、組織版と同じ6つの領域の見出しで束ねる
status: in_progress
created_at: 2026-10-12
implementation_started: true
owner_repository: brainbase
---

# Personal Web のメニューを、組織版と同じ6つの領域の見出しで束ねる

## 利用者成果

Personal Web を開く本人として、組織版と同じ並びと見出しで画面を探したい。組織版は2026-10-12にメニューを6つの領域（世界・目的と現状・仕事・成果・情報と関係・設定）の見出しで束ねたが、Personal Web はまだ見出しのない並び（判断の履歴・議事録・目的と現状・プロジェクトと関係者・情報と関係）のままで、同じ画面が別の順で並んでいる。

## 背景

- brainbase-project の前提台帳（`docs/architecture/oss-personal-web-ux-premises.md`）は、2026-10-12 に D10 を採用した。上位ナビは6つの領域にそろえ、段階1は見出しで束ね、段階2で領域内の切り替えに畳む。世界と目的と現状は見出しを付けない。OSS Personal に無い画面は出さない。
- 組織版の段階1は brainbase-organization #416 で入った。
- 初期画面は、並びの先頭（世界の拡張があれば世界、無ければ判断の履歴）で決まっている。台帳は初期画面を変えると決めていない。

## 受入条件

- [ ] AC-01: メニューは、世界（拡張があれば）・目的と現状・仕事（プロジェクトと関係者・議事録）・成果（判断の履歴）・情報と関係（情報と関係）の順に並ぶ。仕事・成果・情報と関係は、領域名の見出しの下に置き、見出しは `role="group"` と `aria-labelledby` で読み上げる。
- [ ] AC-02: 画面ID（`#value-proofs` など）と初期画面は変えない。`LOCAL_WEB_SCREENS` の並びは変えない。
- [ ] AC-03: 領域を持たない拡張の画面は、これまでどおりの位置に見出しなしで並ぶ（先頭指定の拡張は先頭、それ以外は末尾）。
- [ ] AC-04: 判断の履歴のアイコンを組織版と同じ「履歴」の形にし、メニューの中で同じアイコンを2回使わない。

## 範囲外

- 段階2（領域内の切り替え）。
- 組織版の画面の追加（候補の確認・人と会社など）。

## 検証

- `tests/ui/local-web-shell.test.mjs`、`tests/local-web-host.test.ts`。
