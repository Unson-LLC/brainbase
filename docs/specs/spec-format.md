---
title: brainbase Spec Format v1
status: active
date: 2026-05-11
related_adr: ADR-009
---

# brainbase Spec Format v1

## 目的

実装 story の **契約**を機械可読 + 人間可読な形で明文化する。Spec ↔ Code ↔ Test ↔ PR の整合性を保つための共通フォーマット。

## ファイル配置

```
docs/specs/<story-id-short>-spec.md
```

例：
- `docs/specs/acl-contract-test-spec.md`
- `docs/specs/candidate-store-mvp-spec.md`

`<story-id-short>` は `str.brainbase.` prefix を除いた部分。

## ヘッダー

```yaml
---
spec_id: SPEC-<short-id>
title: <タイトル>
status: draft | active | superseded
date: YYYY-MM-DD
story_id: str.brainbase.<id>
related_adrs:
  - ADR-XXX
related_specs:
  - SPEC-YYY
implementation_files:
  - server/...
  - public/...
test_files:
  - tests/...
---
```

## 必須 5 セクション

### 1. Invariants（不変条件）

常に成り立つべき性質を列挙。番号は `INV-1`, `INV-2`, ... で連番。

```markdown
## Invariants

- **INV-1**: <一文で書ける不変条件>
  - 検証: <verification セクションで test に紐付け>
- **INV-2**: ...
```

例：
```
- INV-1: org_ids が空の entity は visibility=public でなければ retrieval から deny される
- INV-2: candidate-store のレコードは Graph SSOT に直接読み取られない（promote 経由のみ）
```

### 2. Contracts

API / schema / behavior の契約。

```markdown
## Contracts

### Contract-1: <名前>
- **input**: <input schema>
- **output**: <output schema>
- **preconditions**: ...
- **postconditions**: ...
- **error cases**: ...
```

### 3. Scenarios（given/when/then）

具体的な input → expected output / state transitions。番号は `S-1`, `S-2`, ...

```markdown
## Scenarios

### S-1: <シナリオ名>
- **given**: <事前状態>
- **when**: <アクション>
- **then**: <期待結果>
- **検証**: tests/...test.js
```

### 4. Anti-patterns（やってはいけない事）

should NOT happen を明示。番号は `AP-1`, `AP-2`, ...

```markdown
## Anti-patterns

- **AP-1**: <禁止される振る舞い>
  - **理由**: ...
  - **検証**: 負テスト tests/...negative.test.js
```

### 5. Verification

各 clause ID と対応 test の双方向リンク表。

```markdown
## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1 | tests/access-contracts/inv-1-org-ids.test.js | ✅ |
| INV-2 | tests/access-contracts/inv-2-candidate-isolation.test.js | ⏳ |
| S-1 | tests/access-contracts/scenarios/s-1-multi-org.test.js | ✅ |
| AP-1 | tests/access-contracts/anti/ap-1-unknown-deny.test.js | ✅ |
```

## test 側の規約

test name に clause ID を含める。これで grep / search で双方向 traceability が機能する。

```javascript
describe('ACL contract: org_ids', () => {
  it('INV-1: empty org_ids must be deny unless public', async () => {
    // ...
  });

  it('S-1: 4org member can retrieve across 4 orgs', async () => {
    // ...
  });
});
```

## 運用ルール

1. **実装 story の commit 前**に Spec を作成 or 更新する
2. **ADR-only story には Spec 不要**（ADR がその役割）
3. clause ID を test name に埋める
4. Spec 変更時は影響 test と code を update（drift を残さない）
5. PR body には Spec の clause ID を引用（"Implements INV-3 / S-5" 等）

## 将来 VibePro 自動化対象

- clause ID と test name の対応自動検証
- Spec ↔ Code path の双方向 traceability
- Spec drift detection（Spec 変更 → 影響範囲 list）
- Spec coverage（Spec 行 → test 行のマッピング率）

これらが VibePro 本体に integrated されるまで、手動運用 + `scripts/spec-check.sh`（任意）で穴を埋める。

## 関連

- ADR-009: Spec-first principle
- 既存例: `docs/specs/mesh-agent-query-spec.md`
