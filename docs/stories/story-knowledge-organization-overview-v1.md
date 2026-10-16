---
story_id: story-knowledge-organization-overview-v1
title: 上位の知識画面で、プロジェクトを選ばずに見られる範囲の知識・判断を一覧できる
status: active
created_at: 2026-10-16
implementation_started: true
owner_repository: brainbase
depends_on: [story-organization-outcome-ui-upstream-v1]
external_dependencies: []
---

# 上位の知識画面で、プロジェクトを選ばずに見られる範囲の知識・判断を一覧できる

## 利用者成果

組織版の利用者として、上位の「知識」を開いたら、どのプロジェクトの記録かを覚えていなくても、見られる範囲の知識・判断を所属プロジェクト付きで一覧したい。他の画面で最後に選んだプロジェクトに、黙って絞られないでほしい。登録や改訂は、プロジェクトを選んでから今までどおり行いたい。

前提: brainbase-project の前提台帳 D11（佐藤採用 2026-10-16）。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: `ui/outcome-knowledge.js`、`ui/outcome-knowledge.css`、`tests/ui/outcome-knowledge-overview.test.mjs`
- 組織版は、公開後にこの部品を取り込み、全体の一覧の経路（BFF）と画面の切り替えを足す（別の変更）。

## 受入条件

- [x] AC-01: `createKnowledgeOverviewController` は、ホストが渡す一覧の経路（既定 `/api/knowledge/items`）だけを読み、プロジェクトを暗黙に選ばない。右上に固定のプロジェクト表示を出さず、「すべてのプロジェクト」を選んだ状態の絞り込みを出す。
- [x] AC-02: 一覧の各行に所属プロジェクトを出す。組織共通の記録は「組織共通」と出す。ホストが名前を渡せば名前を出す。
- [x] AC-03: 見出しが無い記録は、要旨か本文の最初の行（80字まで）を見出しにする。どれも無ければ「タイトル未確認」とし、題名を作らない。単一プロジェクトの一覧と詳細も同じ規則にする。
- [x] AC-04: 件数を出し、上流が上限で切ったと返したときはそう書く。空のときは「見られる範囲に記録が無い」と「条件に合う記録が無い」を分け、読めなかったときは空と見せない。
- [x] AC-05: 全体の一覧は閲覧だけにする。記録を選ぶと、その記録のプロジェクトの経路で詳細を読み、「このプロジェクトで開く」を出す。絞り込みでプロジェクトを選ぶか、このボタンを押すと、ホストの `onSelectProject(code, context)` を呼ぶ。
- [x] AC-06: 単一プロジェクトの画面は `projectFilter` を受け取ると、固定の「プロジェクト: …」の代わりに、選んだプロジェクトを示す絞り込みを出す。渡さないときは今のまま。
