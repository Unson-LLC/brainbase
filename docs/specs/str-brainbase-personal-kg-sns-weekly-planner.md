---
spec_id: SPEC-personal-kg-sns-weekly-planner
title: Personal KG SNS Weekly Planner
status: implemented
date: 2026-05-12
story_id: str.brainbase.personal-kg-sns-weekly-planner
related_specs:
  - SPEC-personal-kg-sns-seed-mvp
  - SPEC-sns-readonly-curator
  - SPEC-sns-persona-brain-gate
implementation_files:
  - server/services/sns/personal-kg-sns-weekly-planner.js
test_files:
  - tests/sns/weekly-planner/personal-kg-sns-weekly-planner.test.js
---

# SPEC: Personal KG SNS Weekly Planner

## Purpose

個人KG memoryを source にして、1週間分のSNS draft packを作る。投稿実行はしない。目的は、日次の思いつき3投稿ではなく、Persona Brain / Peer Circle / Own Proof を混ぜたレビュー可能な配信計画を作ること。

## Invariants

- **INV-1**: planner は投稿API、scheduler、X APIを呼ばない。出力は `draft_review` の review pack だけ。
- **INV-2**: すべての draft は `kg_source_entity_id`, `derived_from`, `evidence_ids` を持ち、個人KG source に紐づく。
- **INV-3**: すべての draft は complete `persona_brain` を持つ。
- **INV-4**: 既定の1週間 pack は 7日 / 21本で、content mix は `trust_balance=5`, `peer_circle=6`, `own_proof=4`, `philosophy=3`, `learn_in_public=2`, `soft_cta=1`。
- **INV-5**: Peer Circle は自分より少し人気がある近接界隈を優先する。一次 target band は follower 2,000〜20,000、二次 target band は 20,001〜50,000。
- **INV-6**: draft body は投稿API運用を匂わせる表現を含めない。AIを使う文脈は、投稿生成ではなく読者理解・仮説検証・反応学習・思考資産化に寄せる。
- **INV-7**: news / peer signal を使う場合も、必ず個人KG source を anchor にする。
- **INV-8**: 同一日の3 slotでは同じ `kg_source_entity_id` を再利用しない。読者体験上の重複を避け、1日内で信頼・関係・証拠の役割を分ける。
- **INV-9**: planner は KG memory をそのまま投稿本文にしない。Persona Brainに合わせて誤解、不安、自然な次行動が読める copy へ shaping する。
- **INV-10**: laneごとのsource選択では、`philosophy` に Own Proof を混ぜず、`soft_cta` は投稿設計ではなく読者の最初の1業務へ接続する。
- **INV-11**: 公開本文には `Peer Circle`, `Own Proof`, `Learn in Public`, `Soft CTA`, `Graph traversal`, `entity` などの内部運用ラベルを出さない。英語は `Claude Code`, `VibePro`, `AI PM` など必要な固有名詞だけに限定する。
- **INV-12**: 引用元の投稿がない `peer_research_prompt` は本文を作らない。探索方針を読者に見せず、実際の引用リポスト本文は peer signal がある時だけ生成する。
- **INV-13**: X本文は句点 `。` を使わない。

## Contract

```ts
class PersonalKgSnsWeeklyPlanner {
  constructor({ graphReader })
  async buildWeeklyDraftPack(viewer, {
    startDate: string,
    lookbackDays?: number,
    peerSignals?: PeerSignal[],
    newsSignals?: NewsSignal[]
  }): Promise<WeeklyDraftPack>
}
```

`graphReader` は `PersonalKnowledgeGraphReader` と同じ `listRecentEntities({ since, viewer })` contract を満たす。

## Output Shape

```ts
type WeeklyDraft = {
  id: string;
  date: string;
  status: 'draft_review';
  publish_intent: 'manual_review_only';
  lane: 'trust_balance' | 'peer_circle' | 'own_proof' | 'philosophy' | 'learn_in_public' | 'soft_cta';
  format: 'standalone' | 'quote_repost_commentary' | 'peer_research_prompt' | 'news_commentary';
  body: string;
  kg_source_entity_id: string;
  derived_from: string[];
  evidence_ids: any[];
  persona_brain: PersonaBrain;
  signal: PeerSignal | NewsSignal | null;
  safety: {
    requires_human_review: true;
    no_post_api: true;
    no_auto_posting_language: true;
  };
}
```

## Scenarios

### S-1: 1週間分のreview packを作る

- given: 個人KG source が複数件ある
- when: `buildWeeklyDraftPack(viewer, { startDate })`
- then: 7日 / 21本の draft pack が返り、canonical content mix が守られる

### S-2: Peer Circle は同格〜少し上を優先する

- given: follower 900, 8,200, 220,000 の peer signal がある
- when: peer_circle slot を作る
- then: 8,200 follower の signal を優先し、out-of-band signal は使わない

### S-3: PersonalKnowledgeGraphReader をsourceに使える

- given: candidate-store 上の owner-visible personal KG memory
- when: reader を planner に渡す
- then: その memory に紐づく weekly pack が作れる

### S-4: KG memoryを投稿品質へ整える

- given: AI PM memory がある
- when: trust_balance slot を作る
- then: memory fragmentのprefix連結ではなく、読者の誤解から境界設計へ橋渡しする複数行copyになる

### S-5: 1日内のsource重複を避ける

- given: 1日3slotのweekly pattern
- when: weekly pack を作る
- then: 同じ日のdraftは異なる `kg_source_entity_id` を使う

### S-6: 内部運用ラベルを読者に見せない

- given: source memory に `Peer Circle候補` や `Own Proof` が含まれる
- when: weekly pack を作る
- then: 公開本文には内部ラベル、不要な英語、句点が含まれない

### S-7: 引用元未選定なら本文を作らない

- given: peer signal がない
- when: peer slot を作る
- then: `peer_research_prompt` の本文は空で、引用元が決まるまで投稿本文にしない

## Non-goals

- 投稿実行
- X API / bookmark / trend API 取得
- LLMによるコピー生成
- candidate-store への draft 保存
- UI表示

## Verification

| Clause | Test |
|---|---|
| INV-1〜7, S-1〜3 | `tests/sns/weekly-planner/personal-kg-sns-weekly-planner.test.js` |
