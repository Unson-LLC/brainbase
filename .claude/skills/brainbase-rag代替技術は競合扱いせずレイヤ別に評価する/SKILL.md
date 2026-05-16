---
name: brainbase-rag代替技術は競合扱いせずレイヤ別に評価する
description: RAG代替技術は競合扱いせずレイヤ別に評価する
---

# brainbase-rag代替技術は競合扱いせずレイヤ別に評価する

## Trigger
- Use when this pattern appears: RAG代替技術は競合扱いせずレイヤ別に評価する

## Steps
- FTS: 条文番号・固有名詞・数値などの完全一致レイヤ
- Vector/semantic: 言い換え吸収・候補文書検索レイヤ
- Corpus2Skill: コーパス全体の階層ナビゲーションレイヤ
- PageIndex: 1文書/1冊の章立て・ページ参照レイヤ
- 評価時は精度だけでなく、分岐ミス率、出典粒度、token消費、更新コストを比較する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/rag代替技術は競合扱いせずレイヤ別に評価する

## Source
- Promoted from explicit_learn / success