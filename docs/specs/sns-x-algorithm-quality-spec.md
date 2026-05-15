---
spec_id: SPEC-sns-x-algorithm-quality
title: SNS X Algorithm Quality
status: implemented
date: 2026-05-16
story_id: str.brainbase.sns-x-algorithm-quality
related_specs:
  - SPEC-personal-kg-sns-weekly-planner
implementation_files:
  - server/services/sns/personal-kg-sns-weekly-planner.js
test_files:
  - tests/sns/weekly-planner/personal-kg-sns-weekly-planner.test.js
---

# SPEC: SNS X Algorithm Quality

## Purpose

X For You feedの公開READMEで説明されている推薦構造を、brainbaseのSNS draft reviewに使える品質証跡へ落とす。
目的はX algorithmを再現することではなく、Personal KG SNS Weekly Plannerのdraftが「どの候補源から来て、どのpositive actionを狙い、どのnegative feedbackを避け、誰とのgraph edgeを作るのか」をレビュー可能にすること。

## Invariants

- **INV-1**: `algorithm_fit` は deterministic codeで算出し、LLM判定にしない。
- **INV-2**: `algorithm_fit` は `candidate_source`, `predicted_positive_actions`, `predicted_negative_actions`, `negative_feedback_risks`, `author_diversity`, `graph_edge_goal` を持つ。
- **INV-3**: `lane === 'peer_circle' && signal?.author_handle` の分岐では、`candidate_source` は `near_peer_quote` になり、`graph_edge_goal` は `peer_reply_or_repost:<handle>` になる。
- **INV-4**: Peer Circleでpeer signalがない場合、`decision` は `needs_peer_signal` になり、引用本文を捏造しない。
- **INV-5**: Persona Affectがblockedの場合、`negative_feedback_risks` に `negative_persona_affect` が入り、説教調なら `not_interested_risk` を含む。
- **INV-6**: この品質証跡はreview pack metadataであり、投稿API、scheduler、X APIを呼ばない。
- **INV-7**: `lane === 'peer_circle' && !signal?.author_handle` の分岐では、`candidate_source` は `near_peer_research` になり、`decision` は `needs_peer_signal` になる。

## Contract

```ts
function evaluateXAlgorithmFit(input: {
  body: string;
  lane: WeeklyDraftLane;
  signal?: PeerSignal | NewsSignal | null;
  personaAffect?: PersonaAffect;
}): {
  decision: 'reviewable' | 'needs_peer_signal' | 'blocked';
  candidate_source: 'near_peer_quote' | 'near_peer_research' | 'news_context' | 'personal_kg_semantic_anchor';
  predicted_positive_actions: string[];
  predicted_negative_actions: string[];
  negative_feedback_risks: string[];
  author_diversity: {
    scope: 'weekly_pack';
    repeated_author_handle: string | null;
    policy: string;
  };
  graph_edge_goal: string;
}
```

## Scenarios

### S-1: Peer Circle quote creates a graph edge goal

- given: primary-band peer signal `@near_peer_ai_pm`
- when: peer_circle quote draft is created
- then: `algorithm_fit.candidate_source=near_peer_quote`
- and: `algorithm_fit.graph_edge_goal=peer_reply_or_repost:@near_peer_ai_pm`
- and: positive actions include quote, reply, profile_click, dwell

### S-2: Missing peer signal stays as research, not fake quote

- given: no peer signal
- when: peer_circle slot is created
- then: format is `peer_research_prompt`
- and: body is empty
- and: `algorithm_fit.decision=needs_peer_signal`

### S-3: Persona-negative copy becomes algorithm-negative risk

- given: copy that reads as lecturing or internal growth tactic
- when: persona affect blocks it
- then: `algorithm_fit.decision=blocked`
- and: negative feedback risk includes not_interested or mute risk

## Non-goals

- X ranking model reproduction
- X API access
- engagement bait generation
- automatic posting

## Verification

| Clause | Test |
|---|---|
| INV-1〜6, S-1〜3 | `tests/sns/weekly-planner/personal-kg-sns-weekly-planner.test.js` |
