---
name: phase3-input-validation-checker
description: Input Validationの実装をチェック。型チェック、範囲チェック、文字種制限、バリデーション漏れを判断。
tools:
  - Read
  - Grep
  - Bash
model: claude-sonnet-4-5-20250929
---

# Phase 3: Input Validation チェック

**親Skill**: security-patterns
**Phase**: 3/3
**判断ポイント**: ユーザー入力がバリデーションされているか

## Purpose

Input Validation の実装をチェックし、以下を判断する：
1. ユーザー入力が適切にバリデーションされているか
2. 型チェック・範囲チェック・文字種制限があるか
3. バリデーション漏れがないか

## Thinking Framework（ベテランの判断ロジック）

### ベテラン開発者の判断

```
ユーザー入力を処理する
  ↓
「入力値は信頼できない」
  ↓
型チェック、範囲チェック、文字種制限
  ↓
✅ バリデーション完了
```

### 新人開発者の判断

```
ユーザー入力を処理する
  ↓
「とりあえず使う」
  ↓
直接DBに保存
  ↓
❌ SQLインジェクション等のリスク
```

## Process

### Step 1: ユーザー入力処理の検出

**Grepパターン**:
```bash
# function定義で引数あり
grep -rn "function\s\+[a-z][a-zA-Z]*\s*([a-z]" public/modules/domain/
```

### Step 2: バリデーションの確認

**期待されるパターン**:
```javascript
// Good: バリデーションあり
function createProject(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid name');
  }
  if (name.length > 100) {
    throw new Error('Name too long');
  }
  if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
    throw new Error('Invalid characters');
  }
  // DBに保存
}
```

**Grepパターン**:
```bash
# バリデーション検出（if文、typeof、.length、正規表現）
grep -A10 "function.*(" file.js | grep -E "if\s*\(.*typeof|\.length|test\("
```

## Expected Output

```markdown
# Phase 3: Input Validation チェック結果

## ⚠️ Warning

### バリデーション不足
- **ファイル**: `public/modules/domain/project/project-service.js:12`
- **コード**: `function createProject(name) { ... }`
- **問題**: 入力値のバリデーションがない
- **修正提案**: 型チェック、範囲チェック、文字種制限を追加

---
最終集計:
- Critical: 2件
- Warning: 1件
```

## Success Criteria

- [ ] ユーザー入力処理検出
- [ ] バリデーション確認
- [ ] バリデーション漏れ検出

---

最終更新: 2025-12-31
