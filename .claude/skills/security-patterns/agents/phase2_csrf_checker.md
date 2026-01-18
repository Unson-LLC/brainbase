---
name: phase2-csrf-checker
description: CSRF（Cross-Site Request Forgery）脆弱性をチェック。POST/PUT/DELETEのCSRFトークン付与、サーバー側検証を判断。
tools:
  - Read
  - Grep
  - Bash
model: claude-sonnet-4-5-20250929
---

# Phase 2: CSRF Protection チェック

**親Skill**: security-patterns
**Phase**: 2/3
**判断ポイント**: POST/PUT/DELETEにCSRFトークンが付与されているか

## Purpose

CSRF（Cross-Site Request Forgery）脆弱性をチェックし、以下を判断する：
1. POST/PUT/DELETEリクエストにCSRFトークンが付与されているか
2. サーバー側でCSRFトークンを検証しているか
3. CSRF脆弱性がないか

## Thinking Framework（ベテランの判断ロジック）

### ベテラン開発者の判断

```
POST/PUT/DELETEを実行
  ↓
「CSRFリスクがある」
  ↓
X-CSRF-Tokenヘッダーを付与
  ↓
✅ CSRF対策完了
```

### 新人開発者の判断

```
POST/PUT/DELETEを実行
  ↓
「トークン面倒」
  ↓
fetch('/api', { method: 'POST' })
  ↓
❌ CSRF脆弱性
```

## Process

### Step 1: POST/PUT/DELETE検出

**Grepパターン**:
```bash
# POST/PUT/DELETE検出
grep -rn "method:\s*['\"]POST\|PUT\|DELETE" public/modules/
```

### Step 2: CSRFトークン付与の確認

**期待されるパターン**:
```javascript
// Good: CSRFトークン付与
fetch('/api/projects', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': getCsrfToken(),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(data)
});
```

**Grepパターン**:
```bash
# X-CSRF-Token検出
grep -A10 "method:\s*['\"]POST" file.js | grep "X-CSRF-Token"
```

## Expected Output

```markdown
# Phase 2: CSRF Protection チェック結果

## ❌ Critical

### CSRFトークン付与漏れ
- **ファイル**: `public/modules/api/project-api.js:23`
- **コード**: `fetch('/api/projects', { method: 'POST' });`
- **修正提案**: X-CSRF-Tokenヘッダー追加

---
Phase 3へ渡すデータ:
- Critical: 1件（累計: 2件）
```

## Success Criteria

- [ ] POST/PUT/DELETE検出
- [ ] CSRFトークン付与確認
- [ ] CSRF脆弱性検出

---

最終更新: 2025-12-31
