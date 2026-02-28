---
name: security-patterns
description: brainbaseのセキュリティパターン（XSS Prevention、CSRF Protection、Input Validation）への準拠をチェックし、脆弱性を検出して修正提案する3 Phase Orchestrator Skill。
---

# Security Patterns Checker

**目的**: brainbaseの3つのセキュリティ原則への準拠をチェックし、脆弱性を検出して修正提案を行う

このSkillは、CLAUDE.mdで定義されたセキュリティパターンへの準拠を自動的にチェックし、ベテラン開発者のセキュリティ判断ロジックを外付け化します。

## Workflow Overview

```
Phase 1: XSS Prevention チェック
└── agents/phase1_xss_checker.md
    └── ユーザー入力のエスケープを判断
    └── innerHTML使用の妥当性を判断
    └── DOMPurifyサニタイズを確認

Phase 2: CSRF Protection チェック
└── agents/phase2_csrf_checker.md
    └── POST/PUT/DELETEのCSRFトークンを判断
    └── サーバー側検証を確認
    └── トークン付与漏れを検出

Phase 3: Input Validation チェック
└── agents/phase3_input_validation_checker.md
    └── ユーザー入力のバリデーションを判断
    └── 型チェック・範囲チェックを確認
    └── バリデーション漏れを検出
```

## ベテランと新人の差（思考の外付け化）

### ベテラン開発者の判断
- 「ユーザー入力はXSSリスクがある」→ エスケープ必須
- 「POST/PUT/DELETEにはCSRFトークンが必要」→ 全リクエストにトークン付与
- 「入力値は信頼できない」→ バリデーション必須

### 新人開発者の判断
- 「innerHTML便利」→ XSS脆弱性
- 「CSRFトークン面倒」→ CSRF脆弱性
- 「バリデーション忘れた」→ SQLインジェクション等のリスク

→ **このSkillでベテランのセキュリティ判断ロジックを再現**

## 判断による分岐例

```
コード読み込み
  ↓
Phase 1: XSS チェック
  ↓ innerHTML使用あり
  ├─→ DOMPurifyでサニタイズ？
  │   ↓ NO
  │   ├─→ [Critical: XSS脆弱性] をQueueに追加
  │   ↓ YES
  │   └─→ ✅ 合格
  ↓ textContent使用
  └─→ ✅ 合格

Phase 2: CSRF チェック
  ↓ POST/PUT/DELETE あり
  ├─→ CSRFトークン付与？
  │   ↓ NO
  │   ├─→ [Critical: CSRF脆弱性] をQueueに追加
  │   ↓ YES
  │   └─→ サーバー側検証？
  │       ↓ NO
  │       ├─→ [Warning: 検証なし] をQueueに追加
  │       ↓ YES
  │       └─→ ✅ 合格

Phase 3: Input Validation チェック
  ↓ ユーザー入力処理あり
  ├─→ バリデーション？
  │   ↓ NO
  │   ├─→ [Critical: バリデーション漏れ] をQueueに追加
  │   ↓ YES
  │   └─→ ✅ 合格
```

→ **各Phaseで判断し、動的にQueueに積む** = Agenticにする価値がある

## Orchestration Logic

### Phase 1: XSS Prevention チェック

**Subagent**: `agents/phase1_xss_checker.md`

**Input**: チェック対象のファイルパス（または現在の変更）

**Process**:
1. ユーザー入力の表示箇所を検出
2. エスケープ方法を確認
   - `textContent` 使用 ✅
   - `innerHTML` + DOMPurify ✅
   - `innerHTML` 直接代入 ❌
3. XSS脆弱性を検出

**Output**: 違反箇所のリスト、修正提案

### Phase 2: CSRF Protection チェック

**Subagent**: `agents/phase2_csrf_checker.md`

**Input**: Phase 1の結果（オプション）

**Process**:
1. POST/PUT/DELETEリクエストを検出
2. CSRFトークン付与を確認
3. サーバー側検証を確認
4. CSRF脆弱性を検出

**Output**: 違反箇所のリスト、修正提案

### Phase 3: Input Validation チェック

**Subagent**: `agents/phase3_input_validation_checker.md`

**Input**: Phase 2の結果（オプション）

**Process**:
1. ユーザー入力処理を検出
2. バリデーションを確認
   - 型チェック
   - 範囲チェック
   - 文字種制限
3. バリデーション漏れを検出

**Output**: 違反箇所のリスト、修正提案

### 統合・検証

**Orchestratorの責任**:
- 各Phaseの完了を確認
- 脆弱性が見つかった場合、修正提案をQueueに追加
- 全Phaseの結果を統合してレポート生成
- 優先度付け（Critical > Warning > Info）

## Success Criteria

- [ ] Phase 1 XSS チェックが完了
- [ ] Phase 2 CSRF チェックが完了
- [ ] Phase 3 Input Validation チェックが完了
- [ ] 脆弱性が検出された
- [ ] 修正提案が生成された
- [ ] 統合レポートが生成された

## Expected Output

```markdown
# Security Patterns チェック結果

## ❌ Critical（必須修正）

### XSS: innerHTML直接代入
- **ファイル**: `public/modules/views/task-list.js:45`
- **コード**: `element.innerHTML = userInput;`
- **脆弱性**: XSS（Cross-Site Scripting）
- **修正提案**:
  ```javascript
  // Bad: innerHTML直接代入
  element.innerHTML = userInput;

  // Good: textContentでエスケープ
  element.textContent = userInput;

  // または: DOMPurifyでサニタイズ
  import DOMPurify from 'dompurify';
  element.innerHTML = DOMPurify.sanitize(userInput);
  ```

### CSRF: トークン付与漏れ
- **ファイル**: `public/modules/api/project-api.js:23`
- **コード**:
  ```javascript
  fetch('/api/projects', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  ```
- **脆弱性**: CSRF（Cross-Site Request Forgery）
- **修正提案**:
  ```javascript
  // Bad: CSRFトークンなし
  fetch('/api/projects', {
    method: 'POST',
    body: JSON.stringify(data)
  });

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

## ⚠️ Warning（推奨修正）

### Input Validation: バリデーション不足
- **ファイル**: `public/modules/domain/project/project-service.js:12`
- **コード**: `function createProject(name) { ... }`
- **問題**: 入力値のバリデーションがない
- **修正提案**:
  ```javascript
  // Before: バリデーションなし
  function createProject(name) {
    // 直接DBに保存
  }

  // After: バリデーション追加
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

## ✅ 合格

- `public/modules/views/session-selector.js`: textContent使用
- `public/modules/api/task-api.js`: CSRFトークン付与あり

## サマリー

- **総チェック項目**: 15
- **Critical**: 2件
- **Warning**: 1件
- **合格**: 12件

## 推奨アクション

1. XSS: task-list.js:45 を修正（Critical）
2. CSRF: project-api.js:23 を修正（Critical）
3. Input Validation: project-service.js:12 を修正（Warning）
```

## 使い方

```bash
# 全ファイルをチェック
/security-patterns

# 特定のファイルをチェック
/security-patterns public/modules/views/task-list.js

# 現在の変更をチェック（git diff）
/security-patterns --changed-only
```

## Troubleshooting

### Subagentsが起動しない

**原因**: セッション再起動が未実施

**対処**: Claude Codeセッションを再起動

### 誤検出が多い

**原因**: パターンマッチングが厳しすぎる

**対処**: ホワイトリスト（除外ファイル）を追加

## 参照

- **CLAUDE.md**: `§4 Security Guidelines`
- **Skills**: なし（独立動作）
- **Model**: sonnet（全Phase）

---

最終更新: 2025-12-31
brainbase開発ワークフロー自動化
