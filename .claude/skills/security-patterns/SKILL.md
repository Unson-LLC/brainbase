---
name: security-patterns
description: brainbaseのセキュリティパターン（XSS/CSRF対策）を強制する思考フレームワーク
setting_sources: ["user", "project"]
---

# brainbase Security Patterns

## Purpose

XSS/CSRF等の脆弱性を防止し、安全なコードを実装する。

**適用タイミング**:
- ユーザー入力を扱う実装時
- DOM操作時
- API実装時
- コードレビュー時

## Thinking Framework

### 1. XSS Prevention

**原則**: ユーザー入力は常にエスケープする

**思考パターン**:
- ユーザー入力を表示 → 「エスケープしているか？」
- innerHTML使用 → 「本当に必要か？ textContentで代替できないか？」
- サニタイズが必要 → 「DOMPurify等のライブラリを使用しているか？」

**Why**:
- XSS攻撃の防止
- ユーザーデータの安全な表示
- セッションハイジャック防止

**判断基準**:
```javascript
// ✅ Good: textContentでエスケープ
element.textContent = userInput;

// ✅ Good: DOMPurifyでサニタイズ
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userInput);

// ✅ Good: escapeHtml ヘルパー使用
import { escapeHtml } from '/modules/utils/dom-helpers.js';
element.innerHTML = `<div>${escapeHtml(userInput)}</div>`;

// ❌ Bad: innerHTML直接代入
element.innerHTML = userInput; // XSS脆弱性
element.innerHTML = `<div>${userInput}</div>`; // XSS脆弱性
```

**利用可能なヘルパー**:
```javascript
// public/modules/utils/dom-helpers.js
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 使用例
const safeHtml = escapeHtml('<script>alert("XSS")</script>');
// → "&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;"
```

**XSSが発生しやすいパターン**:
```javascript
// ❌ Bad: タスクタイトルをそのまま表示
taskElement.innerHTML = `<h3>${task.title}</h3>`;
// → task.title = '<script>alert("XSS")</script>' の場合、実行される

// ✅ Good: エスケープして表示
taskElement.innerHTML = `<h3>${escapeHtml(task.title)}</h3>`;

// ❌ Bad: URLをそのまま埋め込み
linkElement.innerHTML = `<a href="${userUrl}">Link</a>`;
// → userUrl = 'javascript:alert("XSS")' の場合、実行される

// ✅ Good: URLをバリデーション
if (validators.url(userUrl)) {
  linkElement.innerHTML = `<a href="${escapeHtml(userUrl)}">Link</a>`;
}
```

---

### 2. CSRF Protection

**原則**: すべてのPOST/PUT/DELETEリクエストにCSRFトークンを付与

**思考パターン**:
- POST/PUT/DELETE実行 → 「CSRFトークンを付与しているか？」
- APIエンドポイント追加 → 「CSRF対策が必要か？」
- フォーム送信 → 「CSRFトークンがhiddenフィールドに含まれているか？」

**Why**:
- CSRF攻撃の防止
- 意図しない操作の実行防止
- セッション保護

**判断基準**:
```javascript
// ✅ Good: CSRFトークン付与
fetch('/api/projects', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': getCsrfToken(),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(data)
});

// ❌ Bad: CSRFトークンなし
fetch('/api/projects', {
  method: 'POST',
  body: JSON.stringify(data)
}); // CSRF脆弱性
```

**CSRFトークンの取得**:
```javascript
// public/modules/utils/csrf.js
export function getCsrfToken() {
  // metaタグから取得
  const token = document.querySelector('meta[name="csrf-token"]')?.content;

  if (!token) {
    console.error('CSRF token not found');
    return '';
  }

  return token;
}

// index.html
<meta name="csrf-token" content="<%= csrfToken %>">
```

**サーバー側の検証**:
```javascript
// brainbase-ui/middleware/csrf-protection.js
export function csrfProtection(req, res, next) {
  // GETリクエストはスキップ
  if (req.method === 'GET') {
    return next();
  }

  const token = req.headers['x-csrf-token'];

  if (!token || !isValidToken(token, req.session)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  next();
}

// server.js
app.use(csrfProtection);
```

**HTTPクライアントでの統一処理**:
```javascript
// public/modules/core/http-client.js
export class HttpClient {
  async post(url, data) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'X-CSRF-Token': getCsrfToken(), // 自動付与
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  }

  async put(url, data) {
    return fetch(url, {
      method: 'PUT',
      headers: {
        'X-CSRF-Token': getCsrfToken(), // 自動付与
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
  }

  async delete(url) {
    return fetch(url, {
      method: 'DELETE',
      headers: {
        'X-CSRF-Token': getCsrfToken() // 自動付与
      }
    });
  }
}
```

---

### 3. Input Validation

**原則**: ユーザー入力は常にバリデーションする

**思考パターン**:
- ユーザー入力を処理 → 「バリデーションしているか？」
- 数値入力 → 「範囲チェックしているか？」
- 文字列入力 → 「長さ制限・文字種制限しているか？」

**Why**:
- SQLインジェクション防止
- データ整合性の保証
- 不正な入力の拒否

**判断基準**:
```javascript
// ✅ Good: バリデーション実施
function createProject(name) {
  // 型チェック
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid name');
  }

  // 長さチェック
  if (name.length > 100) {
    throw new Error('Name too long');
  }

  // 文字種チェック
  if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
    throw new Error('Invalid characters');
  }

  // プロジェクト作成処理
}

// ❌ Bad: バリデーションなし
function createProject(name) {
  // 直接DBに保存 ❌ SQLインジェクション等のリスク
}
```

**利用可能なバリデーター**:
```javascript
// public/modules/utils/validators.js
export const validators = {
  projectName: (name) => {
    if (!name || typeof name !== 'string') return false;
    if (name.length > 100) return false;
    return /^[a-zA-Z0-9-_]+$/.test(name);
  },

  email: (email) => {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  url: (url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },

  taskId: (id) => {
    if (!id || typeof id !== 'string') return false;
    return /^[A-Z]+-\d+$/.test(id); // 例: BRAINBASE-123
  }
};

// 使用例
if (!validators.projectName(name)) {
  throw new Error('Invalid project name');
}
```

**サーバー側のバリデーション**:
```javascript
// brainbase-ui/routes/projects.js
app.post('/api/projects', (req, res) => {
  const { name, description } = req.body;

  // バリデーション
  if (!validators.projectName(name)) {
    return res.status(400).json({ error: 'Invalid project name' });
  }

  if (description && description.length > 500) {
    return res.status(400).json({ error: 'Description too long' });
  }

  // プロジェクト作成処理
  projectService.create({ name, description })
    .then(project => res.json(project))
    .catch(err => res.status(500).json({ error: err.message }));
});
```

**クライアント側とサーバー側の二重バリデーション**:
```javascript
// ✅ Good: クライアント側でもサーバー側でもバリデーション
// クライアント側（UX向上）
async function createProject(name) {
  if (!validators.projectName(name)) {
    alert('Invalid project name');
    return;
  }

  // サーバーに送信
  const response = await fetch('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name })
  });

  // サーバー側でもバリデーション（セキュリティ保証）
}
```

---

## Usage

このSkillは以下のタイミングで使用される:

1. **実装時**: ユーザー入力処理・API実装
2. **コードレビュー時**: セキュリティ脆弱性チェック
3. **PR作成時**: 自動チェック

**使用例**:

```
User: "タスクタイトル編集機能を追加したい"

Claude Code: [security-patterns Skillを装備]

思考プロセス:
1. XSS Prevention: タスクタイトルをエスケープして表示
2. CSRF Protection: PUT /api/tasks/:id にCSRFトークン付与
3. Input Validation: タイトルの長さ・文字種をバリデーション

実装:
1. タスクタイトル表示時に escapeHtml() 使用
2. HttpClient.put() でCSRFトークン自動付与
3. validators.taskTitle() でバリデーション
4. サーバー側でも同じバリデーション実施
```

---

## Success Criteria

- [ ] すべてのユーザー入力がエスケープされている
- [ ] innerHTML使用箇所がDOMPurifyでサニタイズされている
- [ ] すべてのPOST/PUT/DELETEにCSRFトークンが付与されている
- [ ] すべてのユーザー入力がバリデーションされている
- [ ] クライアント側とサーバー側で二重バリデーション
- [ ] セキュリティ脆弱性が0件

---

## Enforcement

### Local
- このSkillを装備したClaude Codeが自動チェック
- セキュリティパターン違反を指摘

### CI
- GitHub Actions で `security-check.yml` が実行
- PRマージ前に脆弱性チェック

**チェック項目**:
```bash
# XSS vulnerabilities: エスケープされていないinnerHTML
grep -rn "\.innerHTML\s*=" public/modules --include="*.js" | grep -v "DOMPurify" | grep -v "escapeHtml"

# CSRF protection: CSRFトークンなしのPOST/PUT/DELETE
grep -rn "method:\s*['\"]POST" public/modules --include="*.js" | grep -v "X-CSRF-Token"

# npm audit
npm audit --audit-level=moderate
```

---

## Troubleshooting

### 問題1: DOMPurifyが見つからない

**症状**: `import DOMPurify from 'dompurify'` でエラー

**原因**:
- DOMPurifyがインストールされていない

**対処**:
```bash
npm install dompurify
```

---

### 問題2: CSRFトークンが無効

**症状**: `403 Invalid CSRF token`

**原因**:
- metaタグにCSRFトークンが設定されていない
- セッションが期限切れ

**対処**:
```javascript
// index.htmlにmetaタグを追加
<meta name="csrf-token" content="<%= csrfToken %>">

// サーバー側でCSRFトークンを生成
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
});
```

---

### 問題3: バリデーションが厳しすぎる

**症状**: 正当な入力がバリデーションで弾かれる

**原因**:
- バリデーションルールが実際の要件と合っていない

**対処**:
```javascript
// ❌ Bad: 厳しすぎる
projectName: (name) => /^[a-z]+$/.test(name) // 小文字のみ

// ✅ Good: 実際の要件に合わせる
projectName: (name) => /^[a-zA-Z0-9-_]+$/.test(name) // 英数字、ハイフン、アンダースコア
```

---

### 問題4: サーバー側のバリデーションが不足

**症状**: クライアント側をバイパスして不正なデータが送信される

**原因**:
- サーバー側のバリデーションが実装されていない
- クライアント側のバリデーションのみに依存

**対処**:
```javascript
// ❌ Bad: クライアント側のみ
async function createProject(name) {
  if (!validators.projectName(name)) {
    alert('Invalid name');
    return;
  }
  await fetch('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
}

// ✅ Good: サーバー側でもバリデーション
app.post('/api/projects', (req, res) => {
  const { name } = req.body;

  // 必ずサーバー側でバリデーション
  if (!validators.projectName(name)) {
    return res.status(400).json({ error: 'Invalid name' });
  }

  // プロジェクト作成
});
```

---

## References

### 内部ドキュメント
- [CLAUDE.md](../../CLAUDE.md): 開発標準全体
- `public/modules/utils/dom-helpers.js`: XSS対策ヘルパー
- `public/modules/utils/validators.js`: バリデーター
- `public/modules/utils/csrf.js`: CSRF対策

### 外部リソース
- [OWASP Top 10](https://owasp.org/Top10/): Webアプリケーションセキュリティリスク
- [DOMPurify](https://github.com/cure53/DOMPurify): XSS対策ライブラリ

---

**最終更新**: 2025-12-29
**M5.3 - Development Workflow Standardization**
**Week 2 Day 4: security-patterns Skill**
