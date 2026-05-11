---
spec_id: SPEC-sns-readonly-curator
title: SNS Read-Only Curator Specification
status: draft
date: 2026-05-11
story_id: str.brainbase.sns-readonly-curator
related_adrs:
  - ADR-006
  - ADR-007
  - ADR-008
related_specs:
  - SPEC-candidate-store-mvp
  - SPEC-sns-persona-brain-gate
implementation_files:
  - server/services/sns/curator-scoring.js
  - server/services/sns/sns-readonly-curator.js
test_files:
  - tests/sns/curator/**/*.test.js
---

# SPEC: SNS Read-Only Curator

## 目的

Graph SSOT 上の最近 promote された insight / decision / claim / philosophy を traversal で集め、SNS post draft の **推薦** を candidate-store 経由で個人 KG に書く。投稿実行はしない。

候補生成は **scoring 明示** + LLM は採点者ではなく候補化 step のみ（Codex 警告 #7 対応）。

## Invariants

- **INV-1**: 投稿実行 API を curator は持たない（read-only）。
- **INV-2**: 推薦 draft は candidate-store の `cognitive_type=claim, visibility=owner` として書かれる（promotion gate を通る）。
- **INV-3**: scoring が明示的かつ deterministic（同じ input → 同じ score）。LLM 呼び出しは候補生成のみ。
- **INV-4**: source entity（元 insight / decision）への `derived_from` reference を draft に持つ（provenance）。
- **INV-5**: agency_level=none の entity は候補から除外（INV: SPEC-acl-contract-test S-8 と整合）。
- **INV-6**: rate limit（default 30 draft/day per user）を超えた candidate は作成しない。
- **INV-7**: draft は `persona_brain` を持つ。Persona Brain は読者の脳内モデル（状況、誤解、不安、自然な次行動）を明示する。

## Contracts

### Contract-1: scoring function

```ts
function scoreDraftCandidate(source: Entity, viewer: JWT, history: Array<Entity>): { score: number, breakdown: Record<string, number> }
```

軸（重み付け、合計 100点）:
- novelty (25): 過去 N 日 history に類似なし
- decision_value (20): cognitive_type が claim or decision なら +
- failure_recovery (15): body 内に「失敗→回復」パターン
- evidence_count (10): derived_from edges 数（多いほど良い）
- audience_fit (10): viewer の興味 keyword に hit
- reuse_value (10): 過去 reuse 数
- 炎上 risk (-10〜0): sensitivity / 攻撃的 keyword で減算

### Contract-2: curator API

```ts
class SnsReadonlyCurator {
  async listSourceEntities(viewer: JWT, options: { lookbackDays: number }): Promise<Entity[]>
  async generateDrafts(viewer: JWT, options: { limit: number, llmEnabled?: boolean }): Promise<Draft[]>
  async saveDraftsToCandidateStore(drafts: Draft[]): Promise<{candidate, scoreBreakdown}[]>
}
```

LLM はオプション。enabled=false（テスト） では body は source の paraphrase 不要、source body をそのまま使う。

### Contract-3: persona brain gate

```ts
type PersonaBrain = {
  target_person: string;
  current_situation: string;
  existing_belief: string;
  misunderstanding: string;
  fear: string;
  blocker: string;
  resonant_detail: string;
  avoid_phrasing: string;
  natural_next_action: string;
  success_signal: string;
}
```

すべての field は non-empty string。`saveDraftsToCandidateStore` は `persona_brain` 欠落時に candidate-store mutation 前に失敗する。

## Scenarios

### S-1: 最近 promote された insight → draft 推薦
- given: graph に直近 7 日に promoted な insight が 3 件
- when: generateDrafts(viewer, {limit: 5})
- then: 3 件以下の Draft が score 付きで返る、各 Draft に source_entity_id が含まれる
- 検証: tests/sns/curator/scenarios/s-1-insight-to-draft.test.js

### S-2: saveDraftsToCandidateStore → candidate 作成
- given: 1 件の Draft
- when: saveDraftsToCandidateStore
- then: candidate-store に cognitive_type=claim, visibility=owner, recommended_subject_type=null の row が作成、scoring も保存
- 検証: tests/sns/curator/scenarios/s-2-save-as-candidate.test.js

### S-3: agency_level=none source は除外
- given: 2 entity（one with agency_level=none）
- when: listSourceEntities
- then: agency_level=none は含まれない
- 検証: tests/sns/curator/scenarios/s-3-agency-none-exclude.test.js

### S-4: scoring deterministic
- given: 同じ source + viewer
- when: scoreDraftCandidate を 2 回呼ぶ
- then: 同じ score / breakdown
- 検証: tests/sns/curator/scenarios/s-4-scoring-deterministic.test.js

### S-5: rate limit
- given: 当日すでに 30 件 candidate 作成
- when: generateDrafts → saveDraftsToCandidateStore で 31 件目
- then: 31 件目は skip、scan_blocks ではなく rate_limited として候補が返らない
- 検証: tests/sns/curator/scenarios/s-5-rate-limit.test.js

## Anti-patterns

- **AP-1**: 投稿実行 API を curator に追加する
  - 理由: read-only 原則違反、INV-1
  - 検証: tests/sns/curator/anti/ap-1-no-post-api.test.js

- **AP-2**: LLM 呼び出しで scoring を非決定的に
  - 理由: review queue が不安定化、Codex 警告
  - 検証: tests/sns/curator/anti/ap-2-llm-scoring.test.js

- **AP-3**: candidate-store を bypass して draft を _codex/sns/drafts/ に書く（旧経路）
  - 理由: ADR-007 type taxonomy 違反、graph 経由しない
  - 検証: tests/sns/curator/anti/ap-3-bypass-candidate-store.test.js

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1〜6, S-1〜5, AP-1〜3 | tests/sns/curator/**/*.test.js | ✅ |

合計 14 test files（INV 6 + S 5 + AP 3）。

## 受け入れ基準

- [ ] curator-scoring.js: scoreDraftCandidate（決定論的）
- [ ] sns-readonly-curator.js: listSourceEntities / generateDrafts / saveDraftsToCandidateStore
- [ ] graph traversal は mock interface 経由（実 graph は別 phase）
- [ ] 14 test files pass
- [ ] Spec Verification ✅

## 非選択肢

- 投稿実行 / scheduling
- 投稿結果 metrics 取得
- _codex/sns/drafts/ への file write（旧経路、ADR-007 で deprecated）
