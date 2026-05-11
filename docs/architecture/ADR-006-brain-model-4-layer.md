---
adr_id: ADR-006
title: 4層脳モデル（個人 / チーム / 組織 / シナプス）と認知昇格パスを brainbase の knowledge layer の中核モデルとする
status: accepted
date: 2026-05-11
related_stories:
  - epic.brainbase.knowledge-graph-kernel
  - str.brainbase.brain-model-codification
  - str.brainbase.acl-vocabulary-adr
related_docs:
  - docs/stories/knowledge-graph-kernel-story-map.md
  - docs/frames/mesh-ai-driven-management.md
  - docs/stories/STR-006-mana-secretary-memory-promotion.md
  - docs/architecture/mana-secretary-memory-promotion-architecture.md
supersedes: []
superseded_by: []
---

# ADR-006: 4層脳モデルと認知昇格パスを knowledge layer の中核モデルとする

## 文脈

brainbase は単なるドキュメント / タスク管理ツールではなく、AI ファースト時代の「思考の OS」として knowledge graph を kernel に据える。複数組織（雲孫 / SalesTailor / TechKnight / BAAO）の並立、業務委託メンバーの分散作業、個人と組織の意味記憶の連続性、Mesh による分散層連携──これら全てを支える共通モデルが必要。

既存資産としては Mesh（envelope / Relay / QueryHandler）と STR-006（Activity Dreaming / Memory Promotion）が原型となっている。

## 決定

brainbase の knowledge layer は **4層脳モデル + 認知昇格パス** を中核モデルとする。

### 1. 4層脳モデル

```
個人脳（per-PC、各メンバー）
   ↓ シナプス（Mesh、判断的・選択的）
チーム脳（org 内の sub-team、共有 claim・runbook）
   ↓ 上位昇格
組織脳（4組織並立、philosophy・decision・identity）
   ↓ 公開
公共（OSS）
```

### 2. 真理の検証主体（subjective vs inter-subjective）

| 層 | 真理性 | 検証主体 | 矛盾耐性 |
|---|---|---|---|
| 個人脳 | subjective | 自分一人 | OK（思考進行中） |
| チーム脳 | inter-subjective | チーム合意 / RACI accountable | NG |
| 組織脳 | inter-subjective | 組織合意 / 公式 decision | NG（philosophy は超 stable） |

個人 KG は wild idea / half-formed hypothesis を許容、team / org KG は合意済みの整合性を維持する。

### 3. 認知昇格パス

```
observation → insight → claim → concept / decision → philosophy
（個人）    （個人）  （チーム）  （組織）         （組織）
```

- 個人内で **observation → insight** へ反芻昇格
- 個人 insight が **言語化されて claim** に
- claim が team で合意されて **decision / concept** に
- 反復強化された decision が **philosophy** に

### 4. 記憶タイプの分離

- **エピソード記憶**: observation, event（時系列、減衰あり）
- **意味記憶**: insight, claim, concept, decision, philosophy, glossary_term
- **手続き記憶**: skill, runbook, hook, frame
- **作業記憶**: 現在の session / sprint / active task

質的に異なるため schema や retrieval / decay 戦略を分ける。

### 5. シナプスは判断的・選択的（壁ではない）

- セキュリティ = "アクセス制御" だけでなく **synaptic gating**
- 神経伝達物質 = 文脈つき思考（envelope + provenance + intent + audience model）
- 受容体特異性 = 受け手 context で response 生成変化
- 可塑性 = 信頼は累積する（よく使われる経路が強化）
- reuptake = 撤回可能（promote 取り消し / archive）
- 4組織並立 = 普通の脳間は **fire しない default**、佐藤さんの judgment で例外的に橋渡し

## storage 方針（A1）

- **raw activity は per-PC**（Claude session log / terminal output / voice memo / Slack ひとり言）→ 移動不能
- **normalized memory は central Graph SSOT**（PostgreSQL on Lightsail）→ visibility / owner / scope で論理分離
- 同じ DB に 4 層全部の entity が住み、ACL で分離される

詳細は ADR-007 (Type Taxonomy) と ADR-008 (ACL Vocabulary) で。

## 結果

- knowledge layer の設計判断（schema / curator / promotion / decay / Mesh integration）は全てこのモデルから演繹する
- brain model は philosophy entries として graph 上に codify される（"brain-model-4-layer" / "cognitive-elevation-path" / "memory-types-taxonomy" / "synapse-by-judgment"）
- CLAUDE.md 0.7 (Graph SSOT first) と整合：agent / tool は graph 操作前にこの philosophy を読み込む

## 非選択肢

- 「全部 central」「全部 per-PC」の単一 layer モデル → 個人/チーム/組織の異なる真理性を表現できない
- 「個人 graph 完全分離」（A2）→ 多デバイス sync 問題と多組織重ね問題で破綻
- 「壁ベース」のセキュリティモデル → 認知昇格と信頼可塑性が表現できない
- 「Mesh 経由で個人意味記憶を全部 query」→ 集約層と二重経路（責務重複）

## 開いている問い（次の ADR / Story で解く）

- catalog types と cognitive types の境界（→ ADR-007）
- visibility 4 軸（owner / team / org / public）と既存 projectCodes の正規化（→ ADR-008）
- 認知昇格 workflow を Graph traversal で表現するか別テーブルか（→ str.brainbase.candidate-store-mvp）
- Mesh と central Graph の責務分離（→ str.brainbase.mesh-cross-node-context-boundary）

## 関連参考

- 既存 Mesh frame: `docs/frames/mesh-ai-driven-management.md`
- 既存 STR-006: `docs/stories/STR-006-mana-secretary-memory-promotion.md`
- CLAUDE.md 0.7 Graph SSOT First
