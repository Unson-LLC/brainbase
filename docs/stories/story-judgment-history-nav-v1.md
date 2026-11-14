---
story_id: story-judgment-history-nav-v1
title: 「今日」を「判断の履歴」にし、世界からの降り口を差し替えられるようにする
status: in_progress
created_at: 2026-10-11
implementation_started: true
owner_repository: brainbase
---

# 「今日」を「判断の履歴」にし、世界からの降り口を差し替えられるようにする

## 利用者成果

Personal Web を開く本人として、世界を入口にして、判断の一覧を組織版と同じ「判断の履歴」という名前で開きたい。今は同じ「今日」という語が、OSS では判断の一覧、組織版では期限のタスクを指していて、どちらの画面の話か迷う。

## 背景

- brainbase-project の前提台帳（`docs/architecture/oss-personal-web-ux-premises.md`）は、2026-10-11 に変更提案 U1 を採用した。世界を入口にし、v5 の「今日」は世界に吸収する。判断の一覧は「判断の履歴」として世界から降りる先に置き、旧い入口 `#today?decision=<id>` は新しい経路へ転送する。
- 組織版（`brainbase-organization`）は、同じ一覧を画面ID `value-proofs`・表示語「判断の履歴」で出している。
- 世界の部品（`ui/world/world-view.js`）は、判断へ降りるリンクを `#today` に固定している。組織版はプロジェクトとタスクの降り口を `projectHref`・`taskHref` で差し替えているが、判断の降り口だけは差し替えられず、組織版では `#today` がどの画面にもつながらない。

## 受入条件

- [ ] AC-01: ナビの判断の一覧の画面IDを `value-proofs`、表示語を「判断の履歴」にする。中身（判断価値記録の一覧と詳細）は変えない。
- [ ] AC-02: `#today`・`#today?decision=<id>` を開くと、`value-proofs` の画面が開き、同じ判断が開く。`#value-proofs?decision=<id>` でも同じ判断が開く。
- [ ] AC-03: 世界の部品は、判断へ降りる先を `judgmentHref(decisionAttemptId | null)` で受け取る。渡されなければ `#value-proofs?decision=<id>`（判断を指定しないときは `#value-proofs`）にする。降り口の文言は「「判断の履歴」で開く」にする。
- [ ] AC-04: `brainbase web:serve` が出す案内の行を「判断の履歴」と `#value-proofs` にする。

## 範囲外

- 世界の「あなたを待っている」一覧（U2）、候補の確認（U4）、ルーティンの結果の投影（U3）。
- 組織版が `judgmentHref` を渡す変更（組織版のrepoで行う）。

## 検証

- `tests/ui/local-web-shell.test.mjs`、`tests/ui/world-view*.test.mjs`、`tests/local-web-cli.test.ts`、`tests/local-web-host.test.ts`。
