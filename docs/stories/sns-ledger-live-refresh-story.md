---
story_id: str.brainbase.sns-ledger-live-refresh
title: SNS Ledger Live Refresh
status: active
date: 2026-05-16
reason: "SNS画面の既存UI/API境界内で、Ledger再取得のタイミングを改善するStory。新しいDB、X API、投稿実行方式を決めないため新規ADRは不要。"
related_specs:
  - SPEC-sns-ledger-live-refresh
  - SPEC-sns-growth-cockpit-ui-transition
related_stories:
  - story-sns-posting-cockpit
  - str.brainbase.sns-x-algorithm-quality
---

# Story: SNS Ledger Live Refresh

## User Story

brainbaseで `/ohayo` からSNS投稿候補を作るさとけいとして、
SNS Growth画面を開いたままでも、Ledgerに取り込まれた投稿候補が自然に画面へ反映されてほしい。
そうすれば、ハードリフレッシュせずに、朝の投稿レビューへそのまま入れる。

## Context

`/ohayo` のSNS運用は `npm run sns:import-review-pack` で `POST /api/sns-growth/review-pack` を呼び、Posting Ledgerへ投稿候補を投入する。
SNS Growth画面はmount時と手動の再読み込み時だけ `GET /api/sns-growth/posts` を呼んでいたため、画面を開いた後に `/ohayo` が候補を投入しても、ブラウザのハードリフレッシュまで表示が stale になっていた。

## Scope

- SNS Growth画面が開いている間、Posting Ledgerを定期的に再取得する。
- ブラウザfocus復帰またはvisibility復帰時にPosting Ledgerを再取得する。
- 自動再取得は既存の `GET /api/sns-growth/posts` を使い、新しい投稿APIやX APIを呼ばない。
- 詳細ペインの本文、メモ、metricsなど `data-detail-field` を編集中は、自動再取得で入力を消さない。
- 手動の「再読み込み」は従来通り即時に再取得する。

## Non-goals

- Server-Sent Eventsや新しいWebSocket基盤を追加しない。
- `/ohayo` の投稿生成ロジックを変えない。
- 投稿の承認、予約、投稿実行の状態遷移を変えない。
- X APIやschedulerを呼ばない。

## Acceptance Criteria

- [ ] AC-1: SNS Growth画面は初期表示後も、定期的に `GET /api/sns-growth/posts` を再実行する。
- [ ] AC-2: ブラウザfocus/visibility復帰時に `GET /api/sns-growth/posts` を再実行する。
- [ ] AC-3: 自動再取得で新しいLedger投稿が返った場合、カレンダーと詳細候補に反映される。
- [ ] AC-4: 詳細ペインの `data-detail-field` にfocusがある間は自動再取得をスキップし、編集中の本文やメモを消さない。
- [ ] AC-5: unmount時にintervalとwindow/document listenerを解除し、画面遷移後に再取得し続けない。
