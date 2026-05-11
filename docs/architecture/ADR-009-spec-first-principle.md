---
adr_id: ADR-009
title: Spec-first principle in brainbase（VibePro Spec gate が implicit のため当面手動で運用）
status: accepted
date: 2026-05-11
related_stories:
  - epic.brainbase.knowledge-graph-kernel
related_docs:
  - docs/architecture/ADR-006-brain-model-4-layer.md
  - docs/architecture/ADR-007-type-taxonomy.md
  - docs/architecture/ADR-008-acl-vocabulary.md
  - docs/specs/spec-format.md
upstream_request: vibepro-spec-first-principle
supersedes: []
superseded_by: []
---

# ADR-009: Spec-first principle in brainbase

## 文脈

VibePro の現状は **Story → Architecture → Spec → TDD → Code → Gate → PR** を control plane として提示しているが、Spec gate の挙動が "implicit"（Story acceptance criteria fallback）になっており、Spec を書かなくても gate が通る。具体的には：

- M1 で確認した `gate-dag.json` の `spec` node：`"status": "implicit", "reason": "Story受け入れ基準を仕様として扱う"`
- AC 自体も `"status": "missing"` のことが多い
- 結果として「Spec が無いのに Code が進む」状態を許してしまう

これは VibePro 本体の構造的ギャップであり、product としては Spec が **契約の中心** に座って Code / Test / PR と整合性を保つのが本来の姿。

## 決定

**brainbase 内では Spec を明示必須**にする。VibePro の implicit fallback には乗らない。

### Spec 必須の範囲
- 実装を伴う全 story（M1-3 以降の全実装 story）
- ADR-only story（M1-1 / M1-2 等の設計判断のみ）は **Spec 不要**、ADR がその役割を兼ねる

### Spec format（v1）
`docs/specs/spec-format.md` で標準化。5 セクション：

```
1. Invariants（不変条件）        - INV-X で番号付け
2. Contracts                      - API / schema / behavior
3. Scenarios                      - given / when / then 形式、S-X で番号付け
4. Anti-patterns                  - AP-X で番号付け、should NOT happen
5. Verification                   - 各 clause ID と対応 test の双方向リンク
```

### 配置
- `docs/specs/<story-id-short>-spec.md`
- clause ID（INV-X / S-X / AP-X）は test name にも埋め込む（手動 traceability）

### 運用ルール
- 実装 story の commit 前に Spec を書く（または既存 Spec を update）
- test name に Spec clause ID を含める（grep で双方向検索可能に）
- VibePro pr-prepare の前に Spec の存在を確認する

### 当面ツール（最小）
- 手動運用が基本
- 必要なら `scripts/spec-check.sh`（Spec ファイル存在 + clause ID と test name の対応確認）を内製
- VibePro 本体が Spec gate を実装したら置き換え

## VibePro 本体への feature 要求（upstream）

将来 VibePro product として実装されるべき：

```bash
vibepro spec init --story-id <id>      # Spec scaffolding 生成
vibepro spec verify [--story-id <id>]  # invariant をテストで検証
vibepro spec check                      # Spec ↔ Code ↔ Test 整合性
vibepro spec drift                      # 不整合一覧
vibepro spec coverage                   # Spec → test の網羅率
vibepro gate spec                       # Spec missing/drifted で block
```

これにより：
- Spec ↔ Code ↔ Test ↔ PR の四角形 drift 検出
- バグ = Spec と現実の不一致として定義、機械的に発見
- regression を Spec snapshot diff で検出

upstream への伝え方は別途検討（GitHub issue / VibePro maintainer への直接 feedback）。

## 結果

- M1-3 以降の全実装 story で `docs/specs/<id>-spec.md` を作成
- Spec → test 紐付けは clause ID 埋め込みで運用
- VibePro Spec gate が integrated されるまで手動で穴を埋める

## 非選択肢

- VibePro implicit fallback で済ます → バグ発見性が落ちる、Codex review でも警告された
- 全 story で巨大 Spec を書く → 過剰、ADR-only story には不要
- VibePro 本体に PR を当てる → スコープ大、当面は brainbase 側で運用回す

## 関連

- `docs/specs/spec-format.md`（spec format 標準）
- ADR-006/007/008（M1-1/M1-2 の ADR-only 例）
