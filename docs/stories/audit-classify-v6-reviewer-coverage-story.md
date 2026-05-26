---
story_id: audit-classify-v6-reviewer-coverage
title: 監査 classify.ts の VibePro reviewer 除外 regex を拡張し、真の denominator を測れるようにする
source:
  type: maintenance
  origin: conversation
  url: N/A
  date: 2026-05-24
architecture_docs:
  - path: N/A (ADR)
    status: not_required
    reason: 既存 PR #841 で導入した classify.ts の regex を拡張するだけで、設計変更ではない
related_stories:
  - audit-script-classification-precision
status: in_progress
---

# 監査 classify.ts の VibePro reviewer 除外 regex を拡張し、真の denominator を測れるようにする

## 背景

PR #841 (2026-05-24 merged) で監査スクリプトを永続化し、`EXCLUDE_VIBEPRO_REVIEWER_RE` で VibePro reviewer subagent を除外する仕組みを入れた。しかし、初回 deploy の 2026-05-24 監査で **regex カバレッジが想定の 8% しかない**ことが判明:

- 全 results 内の `(VibePro|\.vibepro/reviews/)` 該当: **348件**
- v5 script の `excluded.vibepro_reviewer`: **27件** (8%)
- 残 **321件 (92%) が分母に残存** → denominator 403 のうち推定 ~321 が reviewer noise

JSON 分析で漏れた 10 種の distinct prefix を抽出 (上位 9 種が VibePro reviewer、1 種は legit な meta discussion):

| # | prefix | 件数 | 除外対象? |
|---|---|---|---|
| 1 | `Read-only VibePro Agent Review.` | 36 | ✅ |
| 2 | `直近でさまざまな開発をVibeProを使って行なっているが...` | 26 | ❌ (legit meta) |
| 3 | `Worktree: ... Review role` | 25 | ✅ |
| 4 | `VibePro required agent review.` | 18 | ✅ |
| 5 | `In /Users/ksato/workspace/code/brainbase, read .vibepro/revi...` | 17 | ✅ |
| 6 | `Read-only VibePro agent review.` (小文字) | 13 | ✅ |
| 7 | `VibePro parallel review.` | 12 | ✅ |
| 8 | `VibePro Agent Review for Brainbase.` | 12 | ✅ |
| 9 | `Aitle repo review task for VibePro story story-ai-search-llm` | 10 | ✅ |
| 10 | `` Read `.vibepro/reviews/oyasumi-conversation-personal-kg/gate `` | 9 | ✅ |

これらを除外できれば、capmap real 0.4% 等の metric が初めて信頼可能になり、介入 (PR #812/#818/#819) の効果を 5日目以降で定量評価できる。

## 方針

`EXCLUDE_VIBEPRO_REVIEWER_RE` を 9 種の reviewer prefix を統合した regex に拡張。`^` アンカーで「途中で VibePro と言及するだけの legit meta prompt」(prefix #2 等) は除外しない。

## 受け入れ基準

### コード

- [ ] `.claude/scripts/audit/classify.ts` の `EXCLUDE_VIBEPRO_REVIEWER_RE` を以下を全て拾うように拡張:
  - `^(?:Read-only\s+)?VibePro\s+(?:review|Review|final|task|gate|parallel|required|Agent\s+Review)`
  - `^You are performing (?:the final )?VibePro` (既存)
  - `^You are reviewing\s+STR-` (既存)
  - `^Re-review\s+STR-` (新規)
  - `^Aitle\s+repo\s+review\s+task` (新規)
  - `` ^Read\s*[`'"]\.vibepro/reviews/ `` (新規)
  - `^In\s+\S+,\s+read\s+\.?vibepro/reviews/` (新規)
  - `^Worktree:.+Review\s+(?:role|task)` (新規)
- [ ] 「途中で VibePro と言及するだけの legit prompt」(例: `直近でさまざまな開発をVibeProを使って行なっているが...`) は除外しない (anchor `^` で担保)

### テスト

- [ ] `.claude/scripts/test/test-classify.ts` に新規 fixture 追加:
  - 陽性 (excluded "vibepro-reviewer"): 9 種の reviewer prefix サンプル
  - 陰性 (excluded null, topic は通常判定): 2 種の legit meta prompt (`直近でさまざまな開発をVibeProを使って…`, `VibePro はすでに SalesTailor に入ってる?`)
- [ ] 既存 22 fixture は全て pass
- [ ] 拡張後 33 fixture 程度を pass

### 検証

- [ ] v6 script で 2026-05-24 監査再実行 → `excluded.vibepro_reviewer` が 27 → 300+ になる
- [ ] 真 denominator (= 総 - excluded) が 371 → ~50 に圧縮される

## 非対象 (scope out)

- excluded breakdown に learning-extractor を別 field として追加する細部改修 (今は `total` だけで集約されている) — 別 Story で
- Phase 2 価値判定 (LLM judgment) の自動化 — script の責務外
- 介入評価レポート自体の改修 — script 改善後に自然に追従する

## 実装タスク

1. clean worktree (済)
2. Story 本文 (本ファイル)
3. test-classify.ts に 9 陽性 + 2 陰性 fixture 追加 (Red)
4. classify.ts EXCLUDE_VIBEPRO_REVIEWER_RE 拡張 (Green)
5. smoke run で denominator 圧縮確認
6. commit + vibepro pr prepare + PR

## 検証コマンド

```bash
npx tsx --test .claude/scripts/test/test-classify.ts
npx tsx .claude/scripts/audit/graph-ssot-audit.ts --hours 24 --out /tmp/audit-v6-smoke.json
python3 -c "import json; d=json.load(open('/tmp/audit-v6-smoke.json')); print('excluded:', d['excluded']); print('真denom:', d['totals']['all'] - d['excluded']['total'])"
```

## 関連

- PR #841 (前段、本 Story の前提)
- 監査レポート: `_inbox/graph-ssot-monitor/2026-05-24-v2-script.md` (script 初回 deploy 結果)
- JSON sample: `/tmp/graph_ssot_audit_2026_05_24_v5.json`
