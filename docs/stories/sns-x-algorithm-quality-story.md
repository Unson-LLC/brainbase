---
story_id: str.brainbase.sns-x-algorithm-quality
title: SNS X Algorithm Quality
status: active
date: 2026-05-16
reason: "Personal KG SNS Weekly Plannerの品質証跡を追加する既存境界内のStoryであり、新しい外部連携、DB、投稿実行方式を決めないため新規ADRは不要。"
related_specs:
  - SPEC-sns-x-algorithm-quality
  - SPEC-personal-kg-sns-weekly-planner
related_stories:
  - str.brainbase.personal-kg-sns-weekly-planner
  - story-sns-persona-brain-gate
  - story-sns-posting-cockpit
external_sources:
  - https://github.com/xai-org/x-algorithm
---

# Story: SNS X Algorithm Quality

## User Story

brainbaseでSNS運用を回すさとけいとして、
Personal KGから作るSNS draftに、X For Youの推薦構造を踏まえた品質証跡を持たせたい。
そうすれば、単に「良い文章」ではなく、誰に届き、どんなpositive actionを生み、どんなnegative feedbackを避ける投稿かをレビュー時に判断できる。

## Context

2026-05-16に `xai-org/x-algorithm` を確認した。
README上の説明では、X For You feedは in-network候補、out-of-network候補、hydration、filtering、Grok系transformerによるmulti-action prediction、weighted score、author diversity、post-selection filterで構成される。

これをSNS運用に直訳すると、投稿案は以下を満たす必要がある。

- `like` だけでなく、reply / repost / quote / profile click / dwell を意識する。
- `not interested` / mute / block / report につながる読者感情を避ける。
- Peer Circleでは、近い界隈の同格〜少し上の人に「仲間」として拾われる引用文脈を作る。
- Personal KG由来の思想はout-of-networkで意味的に近い人へ届く可能性があるため、KG anchorを残す。
- 同じ話題・同じ相手・同じ語り口の連続でauthor diversityを落とさない。

## Business Context

BrainbaseのSNS運用は、AIに投稿させることではなく、個人の思想・実績・関係性を継続的に配信し、反応を学習へ戻す運用である。
そのため投稿本文だけを作っても不十分で、投稿ごとに「この投稿はどの関係を作るのか」「読者はどう反応しそうか」「負の反応はどこにあるか」をレビュー可能にする必要がある。

## Scope

- Personal KG SNS Weekly Plannerのdraftに `algorithm_fit` を追加する。
- `algorithm_fit` は deterministic に算出し、LLM判断にしない。
- `algorithm_fit` は candidate source、predicted positive actions、predicted negative actions、negative feedback risks、author diversity policy、graph edge goalを持つ。
- Persona Affectでblockedになった本文は、X algorithm fitでもnegative feedback riskとして扱う。
- Peer Circleの引用draftは、引用先のhandleをgraph edge goalに含める。
- `lane === 'peer_circle'` かつ `signal.author_handle` がある場合、そのhandleを `peer_reply_or_repost:<handle>` として明示する。
- 引用元未選定のpeer slotは `needs_peer_signal` として本文を作らない。

## Requirement Invariants

- `lane === 'peer_circle' && signal?.author_handle` の分岐は、quote draftの `candidate_source` を `near_peer_quote` にし、`graph_edge_goal` を `peer_reply_or_repost:<handle>` にするためだけに使う。
- `lane === 'peer_circle' && !signal?.author_handle` の分岐は、引用先を捏造せず `decision=needs_peer_signal` としてレビュー前の調査対象に残す。

## Non-goals

- X algorithm repoのコードを取り込まない。
- X APIやbookmark APIを新規に呼ばない。
- 投稿を自動公開しない。
- weighted scoreやTransformer推論をbrainbase内で再現しない。
- algorithm hackやengagement baitを作らない。

## Acceptance Criteria

- [ ] AC-1: すべてのweekly draftは `algorithm_fit` を持つ。
- [ ] AC-2: `algorithm_fit.predicted_positive_actions` は lane / signal に応じて reply, quote, repost, profile_click, dwell, bookmark などを含む。
- [ ] AC-3: Persona Affectがblockedの本文は、`negative_feedback_risks` に `negative_persona_affect` と適切な negative action risk を持つ。
- [ ] AC-4: `lane === 'peer_circle' && signal?.author_handle` のquote draftは `candidate_source=near_peer_quote` と `graph_edge_goal=peer_reply_or_repost:<handle>` を持つ。
- [ ] AC-5: Peer signalがないpeer slotは `decision=needs_peer_signal` になり、引用本文を捏造しない。
- [ ] AC-6: この改善はreview packの証跡追加に留まり、投稿API、scheduler、X APIを呼ばない。
