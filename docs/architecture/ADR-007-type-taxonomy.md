---
adr_id: ADR-007
title: Type Taxonomy（catalog types vs cognitive types）と layer 帰属の傾向
status: accepted
date: 2026-05-11
related_stories:
  - str.brainbase.brain-model-codification
  - str.brainbase.candidate-store-mvp
  - str.brainbase.new-type-judgment-gate
related_docs:
  - docs/architecture/ADR-006-brain-model-4-layer.md
  - docs/stories/knowledge-graph-kernel-story-map.md
  - docs/stories/STR-006-mana-secretary-memory-promotion.md
supersedes: []
superseded_by: []
---

# ADR-007: Type Taxonomy（catalog types vs cognitive types）

## 文脈

brainbase の knowledge layer に「個人 graph」「チーム graph」「組織 graph」が住む（ADR-006）が、type catalog をどう設計するかで設計の方向が大きく分岐する：

- 案 X: 個人 / チーム / 組織で別々の type 集合
- 案 Y: 共通 1 catalog、layer は visibility で分離
- 案 Z: 認知昇格パス（observation → insight → claim → ...）を全部 Graph entity 化

STR-006 は「既存 14 type で表現できない限り新 type を増やさない」と保守的。Codex review も「拡張 type を Graph に先入れすると戻せない」と警告。

## 決定

**type catalog は 1 本化、layer は visibility で分離**。ただし type を 2 群に分類して扱いを分ける。

### 1. catalog types（既存 14 中心、stable identity）

- person / org / customer / partner / contact / project / app / brand / frame / decision / philosophy / glossary_term / story / raci_assignment
- **Graph SSOT に住む**（PostgreSQL）
- volatility 低、長期保存、明確な entity identity
- 主たる layer: team / org（個人 graph には person=自分 / project=個人 の例外のみ）

### 2. cognitive types（拡張候補、認知昇格パス）

- observation / insight / claim / preference / hypothesis / experiment / result / source / event
- **candidate-store table に住む**（Graph SSOT と分離）
- volatility 高、減衰あり、思考の進行中状態
- 主たる layer: 個人（promote 時のみ catalog type にマップして Graph SSOT へ）

### 3. layer 帰属の傾向（参照表）

| Type | 個人 | チーム | 組織 | 主 layer | 分類 |
|---|---|---|---|---|---|
| observation | ◎ | △ | ✗ | 個人 | cognitive |
| insight | ◎ | ○ | △ | 個人 → 集合知 | cognitive |
| preference | ◎ | ✗ | ✗ | 個人のみ | cognitive |
| hypothesis | ◎ | ○ | △ | 個人 | cognitive |
| claim | ○ | ◎ | ○ | チーム | cognitive |
| concept | ○ | ◎ | ◎ | チーム / 組織 | cognitive |
| source | ◎ | ◎ | ○ | 全層 | cognitive |
| event | ◎ | ◎ | ◎ | 全層 | cognitive |
| experiment / result | ◎ | ◎ | △ | 個人 / チーム | cognitive |
| decision | △ | ◎ | ◎ | チーム / 組織 | **catalog** |
| philosophy | △ | ○ | ◎ | 組織 | **catalog** |
| glossary_term | △ | ◎ | ◎ | チーム / 組織 | **catalog** |
| raci_assignment | ✗ | ◎ | ◎ | チーム / 組織 | **catalog** |
| person | ✗ | ○ | ◎ | 組織（例外: 個人 graph で自分） | **catalog** |
| org | ✗ | ✗ | ◎ | 組織 | **catalog** |
| customer | ✗ | ◎ | ◎ | 組織 | **catalog** |
| partner | ✗ | ◎ | ◎ | 組織 | **catalog** |
| contact | ✗ | ◎ | ◎ | 組織 | **catalog** |
| project | △ | ◎ | ◎ | チーム / 組織（例外: 個人 graph で個人 project） | **catalog** |
| app | ✗ | ◎ | ◎ | 組織 | **catalog** |
| brand | ✗ | △ | ◎ | 組織 | **catalog** |
| frame | ✗ | ○ | ◎ | 組織 | **catalog** |
| story | ○ | ◎ | ○ | チーム | **catalog** |

◎=主役 / ○=ある / △=稀 / ✗=不自然

### 4. promotion パターン（cognitive → catalog）

3 パターンを許容、**default は a**：

| パターン | 説明 |
|---|---|
| **a. 別 instance + derived_from edge** | 個人 insight → 新 catalog entity を作る、元 candidate は残す（不可逆性・provenance 保持） |
| b. 同一 instance + visibility 変更 | 稀。private hypothesis を team 共有する時など |
| c. cross-layer reference のみ | 個人 observation が team customer entity を mention（reference edge のみ） |

### 5. 新 type 追加ルール（judgment gate）

- 既存 catalog type で表現できない事例を candidate-store の `failed-mapping log` に蓄積
- 月次 review で確認
- 判定基準: 3件以上の独立 use case / payload 拡張で吸収不可 / scope・lifetime・visibility 規則明確
- cognitive types を Graph 化する場合は **特に厳しい基準**（多くは candidate-store のままで十分）
- 承認された type のみ schema migration（既存互換性を破壊しない）

## 結果

- candidate-store 設計に cognitive type field を持たせる（observation / insight / claim / ...）
- Graph SSOT の subject_type は既存 14 catalog type に限定（STR-006 と整合）
- 個人 graph の実態 = central Graph SSOT 上の visibility=owner エントリ + candidate-store の personal scope
- 全 entity（catalog / cognitive）に owner / visibility / org / project / sensitivity の ACL axis が付与される（ADR-008 で詳細）

## 非選択肢

- 個人 / チーム / 組織で別 type catalog（案 X）→ 物理的に分断、cross-layer reference 不能
- observation / insight を即 Graph type 化（案 Z）→ Codex 警告通り schema 肥大化、戻せない
- promotion 時 instance 移動（同一 instance の visibility 上書き）→ provenance 喪失

## 開いている問い

- candidate-store の retention policy（個人 observation を何日で archive？）→ candidate-store-mvp で決める
- promote 時の catalog type マッピング自動化レベル → candidate-store-mvp で決める
- cognitive types に新規追加が必要になった時の手続き → new-type-judgment-gate で運用化

## 関連

- ADR-006: 4層脳モデル
- ADR-008: ACL Vocabulary（visibility / owner / org / scope）── 次に書く
- STR-006 architecture: Memory Candidate Store の設計
- Story: str.brainbase.candidate-store-mvp / new-type-judgment-gate
