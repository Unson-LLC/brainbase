# KERNEL Principles: Skills Evaluation Framework

**Version**: 1.0.0
**Last Updated**: 2026-03-05
**Maintainer**: Unson LLC

---

## 概要

KERNELフレームワークは、1000時間以上のプロンプトエンジニアリング実験から発見された、一貫して高品質なAI指示を生み出す6つの原則体系です。GPT、Claude、Gemini、Llamaで検証済み。

### 実績

| 指標 | 改善率 |
|------|--------|
| **精度向上** | 340% |
| **作業時間削減** | 67% |
| **不要出力削減** | 91%（制約明記時） |
| **トークン使用量** | 50%削減 |

### brainbaseでの適用

本ドキュメントは、`.claude/skills/` 配下の全Skillsを評価するための正本定義として機能します。各Skillsは、以下の6原則に基づいて0-1スケールでスコアリングされ、自動最適化の優先度が決定されます。

---

## KERNEL 6原則

### 1. K - Knowledge Integration（知識統合）

**定義**: ドメイン固有の情報をプロンプトに埋め込み、文脈的関連性を高める。

**評価基準（0-1スコアリング）**:

| スコア | 基準 | 説明 |
|--------|------|------|
| **1.0** | 完全 | ドメイン知識が明示的に記述され、専門用語が正確に定義されている |
| **0.7-0.9** | 良好 | 基本的なドメイン知識は含まれるが、一部専門用語の定義が欠ける |
| **0.4-0.6** | 不十分 | ドメイン知識の記述が断片的、または前提知識が不明確 |
| **0.0-0.3** | 不合格 | ドメイン知識が全く含まれず、文脈が不明瞭 |

**評価チェックリスト**:
- [ ] Contextセクションに背景情報が明示されているか？
- [ ] 専門用語が定義されているか（または参照リンクがあるか）？
- [ ] ドメイン固有の制約・ルールが明記されているか？
- [ ] 前提知識が不要なレベルまで説明されているか？

**Good実装例**:
```markdown
## Context
brainbaseのEventBus（`public/modules/core/event-bus.js`）は、
全モジュール間の状態変更通知を一元管理するPub/Subパターン実装です。
EVENTS定数（`TASK_COMPLETED`、`SESSION_CHANGED`等）を使用し、
同期（`on`）と非同期（`onAsync`）の2種類のリスナーをサポートします。
```

**Bad実装例**:
```markdown
## Context
EventBusを使います。
```

---

### 2. E - Explicitness（明示性）

**定義**: 曖昧さを排除し、具体的で明確な指示を与える。

**評価基準（0-1スコアリング）**:

| スコア | 基準 | 説明 |
|--------|------|------|
| **1.0** | 完全 | 指示が具体的で、解釈の余地がない。1プロンプト1目標を遵守 |
| **0.7-0.9** | 良好 | 指示は明確だが、一部曖昧な表現が残る |
| **0.4-0.6** | 不十分 | 指示が抽象的、または複数目標が混在 |
| **0.0-0.3** | 不合格 | 指示が曖昧で、実行方法が不明 |

**統計データ**:
- 単一目標のプロンプト: 満足度89%
- 複数目標のプロンプト: 満足度41%

**評価チェックリスト**:
- [ ] Taskセクションに1つの明確な目標が定義されているか？
- [ ] 「現在のトレンド」等の時間依存表現を避けているか？
- [ ] 成功基準（Success Criteria）が明記されているか？
- [ ] 曖昧な動詞（「改善」「最適化」等）が具体的行動に置き換えられているか？

**Good実装例**:
```markdown
## Task
`public/modules/domain/task/task-service.js` の `completeTask()` メソッドに、
タスク完了時に `EVENTS.TASK_COMPLETED` イベントを発火する処理を追加してください。

## Success Criteria
- [ ] `eventBus.emit(EVENTS.TASK_COMPLETED, { taskId })` が呼び出される
- [ ] 既存テストが全てパスする
- [ ] 新規ユニットテストが追加される（カバレッジ80%以上）
```

**Bad実装例**:
```markdown
## Task
タスク完了機能を改善してください。
```

---

### 3. R - Reusability（再利用性）

**定義**: モジュラー設計でプロンプトを構築し、様々なシナリオで活用可能にする。

**評価基準（0-1スコアリング）**:

| スコア | 基準 | 説明 |
|--------|------|------|
| **1.0** | 完全 | テンプレート化されており、パラメータ変更で他ケースに適用可能 |
| **0.7-0.9** | 良好 | 一部再利用可能だが、特定ケースに依存する箇所がある |
| **0.4-0.6** | 不十分 | ハードコードされた値が多く、汎用性に欠ける |
| **0.0-0.3** | 不合格 | 完全に特定ケースに特化、再利用不可 |

**評価チェックリスト**:
- [ ] Context/Task/Constraints/Formatの4セクション構造か？
- [ ] パラメータが変数化されているか（`{project_name}`等）？
- [ ] 他Skillsと共通のテンプレートパターンを使用しているか？
- [ ] Skill名が汎用的か（特定プロジェクト名に依存しないか）？

**Good実装例**:
```markdown
## Context
{service_name}（`{file_path}`）の{method_name}メソッドを修正します。

## Task
{event_name}イベント発火処理を追加してください。
```

**Bad実装例**:
```markdown
## Context
TaskServiceのcompleteTaskメソッドを修正します。

## Task
TASK_COMPLETEDイベントを発火してください。
```

---

### 4. N - Non-redundancy（非冗長性）

**定義**: 不要な要素を排除し、プロンプト構造を簡潔にする。

**評価基準（0-1スコアリング）**:

| スコア | 基準 | 説明 |
|--------|------|------|
| **1.0** | 完全 | 全要素が必要最小限、重複なし。トークン効率が最適 |
| **0.7-0.9** | 良好 | 一部冗長な説明があるが、許容範囲 |
| **0.4-0.6** | 不十分 | 重複した説明、不要なセクションが目立つ |
| **0.0-0.3** | 不合格 | 大量の冗長性、トークンの無駄遣い |

**原則**:
- 500語の段落 ≠ 賢いプロンプト
- 1つの明確な目標 = 効果的なプロンプト
- トークン使用量を半減させながら品質向上

**評価チェックリスト**:
- [ ] 同じ情報が複数箇所で繰り返されていないか？
- [ ] 不要なセクション（空のConstraints等）がないか？
- [ ] 1センテンスで表現できる内容が段落になっていないか？
- [ ] コード例が最小限か（全体を貼らず、関連部分のみ）？

**Good実装例**:
```markdown
## Constraints
- EventBus経由でのみ状態変更を通知
- 直接のDOM操作禁止
```

**Bad実装例**:
```markdown
## Constraints
- 状態変更時は必ずEventBusを使用してください。EventBusはpublic/modules/core/event-bus.jsにあります。EventBusを使わない場合、他のモジュールが状態変更を検知できません。必ずEventBusを経由してイベントを発火してください。
- DOMを直接操作してはいけません。DOMを直接操作すると、Reactive Storeとの同期が崩れます。必ずStoreを更新してください。Storeを更新すれば、自動的にDOMが更新されます。
```

---

### 5. E - Error-resilience（エラー耐性）

**定義**: 入力エラーや不確実性に対処するメカニズムを組み込む。

**評価基準（0-1スコアリング）**:

| スコア | 基準 | 説明 |
|--------|------|------|
| **1.0** | 完全 | エラーハンドリング、フォールバック、確認プロンプトが完備 |
| **0.7-0.9** | 良好 | 基本的なエラー対処は含まれるが、エッジケースが一部未対応 |
| **0.4-0.6** | 不十分 | エラー処理の言及が少なく、ハッピーパスのみ |
| **0.0-0.3** | 不合格 | エラー処理の考慮が全くない |

**評価チェックリスト**:
- [ ] 「〜の場合は」という条件分岐が含まれるか？
- [ ] エッジケース（存在しないID、空配列等）への対応が指示されているか？
- [ ] 不明点があれば確認を求める指示があるか？
- [ ] ロールバック・リトライの手順が含まれるか？

**Good実装例**:
```markdown
## Task
タスクを完了状態に更新してください。

## Error Handling
- タスクIDが存在しない場合: `Error('Task not found')` を投げる
- 既に完了済みの場合: 冪等性を保ち、エラーを投げない
- EventBus発火失敗時: ログ記録後、処理を継続（非クリティカル）

## Fallback
EventBus初期化前の場合は、処理をスキップしてwarningログを出力。
```

**Bad実装例**:
```markdown
## Task
タスクを完了状態に更新してください。
```

---

### 6. L - Linguistic Precision（言語的精度）

**定義**: AIシステムが正確に理解できるよう、言語的に精密なプロンプトを作成する。

**評価基準（0-1スコアリング）**:

| スコア | 基準 | 説明 |
|--------|------|------|
| **1.0** | 完全 | 専門用語が正確、否定形が明示、数値・形式が具体的 |
| **0.7-0.9** | 良好 | 用語は正確だが、一部定量性に欠ける |
| **0.4-0.6** | 不十分 | 曖昧な用語、数値の欠如 |
| **0.0-0.3** | 不合格 | 用語の誤用、言語的に不正確 |

**テクニック**:
- 「〜しない」を明示（不要出力91%削減）
- 具体的な数値・形式を指定
- 専門用語を適切に使用

**評価チェックリスト**:
- [ ] 禁止事項が「〜しない」形式で明示されているか？
- [ ] 数値が具体的か（「少し」→「10%以内」）？
- [ ] ファイルパス・API名等が正確か？
- [ ] 専門用語が一貫して使用されているか（揺れがないか）？

**Good実装例**:
```markdown
## Constraints
- `innerHTML` を使用しない（XSS脆弱性）
- 500行以上のファイルは作成しない
- `public/modules/` 以外のディレクトリを変更しない

## Format
JSON形式、UTF-8エンコード、改行コード: LF
ファイルサイズ: 10KB以内
```

**Bad実装例**:
```markdown
## Constraints
- セキュリティに注意
- 大きすぎるファイルは作らない
- 関係ないところを変更しない

## Format
JSONで返してください。
```

---

## 評価方法論

### 総合スコア計算

各Skillsは、6原則すべてについて0-1スコアリングされ、平均値が算出されます。

```javascript
kernelScore = (K + E + R + N + E + L) / 6
```

### リスク分類

| リスク | スコア範囲 | 対応 |
|--------|----------|------|
| **🔴 High Risk** | < 0.5 | 緊急対応必要。包括的なリライトを推奨 |
| **🟡 Medium Risk** | 0.5-0.7 | 改善推奨。週次バッチで最適化候補生成 |
| **🟢 Low Risk** | >= 0.7 | 良好。現状維持または軽微な改善 |

### 自動最適化の優先度

Skills自動最適化システム（Phase 1-5実装済み）では、以下の優先順位で処理されます：

1. **High Risk（< 0.5）**: 即座に最適化候補生成、人間承認必須
2. **Medium Risk（0.5-0.7）**: 週次バッチで最適化、A/Bテスト後デプロイ
3. **Low Risk（>= 0.7）**: 監視のみ、定期レビューで軽微な改善

---

## 実装例: SessionMonitor Skill評価

### 評価対象Skill（架空）

```markdown
---
name: session-monitor
description: セッション終了時に学習候補を抽出する
---

## Context
セッションが終わったら、学習候補を保存します。

## Task
学習候補を抽出してください。

## Format
JSONで返してください。
```

### KERNEL評価結果

| 原則 | スコア | 診断 |
|------|--------|------|
| **K - Knowledge** | 0.3 | ❌ ドメイン知識不足（EventBus、Storeの説明なし） |
| **E - Explicitness** | 0.4 | ❌ 指示が曖昧（「学習候補」の定義なし） |
| **R - Reusability** | 0.5 | ⚠️ テンプレート化されていない |
| **N - Non-redundancy** | 0.8 | ✅ 簡潔だが、情報不足 |
| **E - Error-resilience** | 0.2 | ❌ エラー処理の言及なし |
| **L - Linguistic Precision** | 0.4 | ❌ 数値・形式が不明確 |

**総合スコア**: 0.43 → **🔴 High Risk**

### 改善提案（自動生成）

```markdown
---
name: session-monitor
description: セッション終了時にSkills使用履歴を抽出し、~/workspace/.claude/skills-usage/に保存する
---

## Context
brainbaseのSessionMonitor（`public/modules/skills/session-monitor.js`）は、
セッションアーカイブ時に`SESSION_ARCHIVED`イベントをリスニングし、
Skills使用履歴（成功/失敗、metrics、learnings）を抽出します。
抽出データは`~/workspace/.claude/skills-usage/{skill}_{session}.json`に保存され、
週次バッチ評価（`scripts/evaluate-skills-kernel.js`）の入力として使用されます。

## Task
セッションアーカイブ時に、以下のデータを抽出してJSONファイルに保存してください：
1. セッションID
2. 使用されたSkill名
3. 成功/失敗フラグ
4. メトリクス（messageCount、errorCount、completionTime）
5. 学習候補（title、category、content、confidence）

## Constraints
- EventBus経由でのみ`SESSION_ARCHIVED`を購読
- 処理失敗時もアプリケーションを継続（非クリティカル機能）
- 重複処理を防ぐため、`.processed_sessions`で管理
- ファイルサイズ上限: 100KB/ファイル

## Format
```json
{
  "sessionId": "session-1234567890",
  "skillName": "commit",
  "timestamp": "2026-03-05T12:34:56.789Z",
  "success": true,
  "metrics": {
    "messageCount": 15,
    "errorCount": 0,
    "completionTime": 300000
  },
  "learnings": [
    {
      "title": "Conventional Commits準拠",
      "category": "git-workflow",
      "content": "type: scope形式でコミットメッセージを書く",
      "confidence": 0.9
    }
  ]
}
```

## Success Criteria
- [ ] セッションアーカイブ時に自動実行される
- [ ] JSONファイルが`~/workspace/.claude/skills-usage/`に作成される
- [ ] `.processed_sessions`に処理済みセッションIDが追記される
- [ ] 重複処理が発生しない（idempotency）
- [ ] エラー時もアプリケーション起動が継続する

## Error Handling
- セッションIDが存在しない場合: ログ記録後、処理スキップ
- ファイル書き込み失敗時: リトライ3回、失敗ならログ記録
- EventBus未初期化時: graceful degradation（警告のみ）
```

**改善後スコア**: 0.85 → **🟢 Low Risk**

---

## Skills評価スクリプトからの参照方法

### 1. Node.jsで読み込み

```javascript
import fs from 'fs/promises';
import path from 'path';

const KERNEL_PRINCIPLES_PATH = path.join(
  process.cwd(),
  'docs',
  'KERNEL-PRINCIPLES.md'
);

async function loadKERNELPrinciples() {
  const content = await fs.readFile(KERNEL_PRINCIPLES_PATH, 'utf-8');
  return content;
}

// LLMへのプロンプトに含める
const prompt = `
Evaluate the following Skill against KERNEL 6 principles.

KERNEL Principles:
${await loadKERNELPrinciples()}

Skill Content:
${skillContent}

Output JSON:
{
  "knowledge": { "score": 0-1, "diagnosis": "..." },
  "explicitness": { "score": 0-1, "diagnosis": "..." },
  "reusability": { "score": 0-1, "diagnosis": "..." },
  "non_redundancy": { "score": 0-1, "diagnosis": "..." },
  "error_resilience": { "score": 0-1, "diagnosis": "..." },
  "linguistic_precision": { "score": 0-1, "diagnosis": "..." },
  "overall_score": 0-1
}
`;
```

### 2. GitHub Actionsで参照

```yaml
- name: Run KERNEL Evaluation
  env:
    ANTHROPIC_API_KEY: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  run: |
    node scripts/evaluate-skills-kernel.js \
      --kernel-principles=docs/KERNEL-PRINCIPLES.md \
      --output=/tmp/evaluation-results.json
```

---

## ベストプラクティス

### Skill作成時

1. **1プロンプト1目標**: 複数タスクは分割
2. **制約を明記**: 「〜しない」が重要
3. **成功基準を定義**: 評価可能な形で
4. **具体例を含める**: Few-shotで精度向上
5. **反復改善**: 結果を見てプロンプトを調整

### Skills評価時

1. **全6原則をチェック**: 1つでも低スコアなら改善対象
2. **定量評価を優先**: 主観を排除、0-1スコアで判断
3. **改善候補は具体的に**: 「曖昧」ではなく「どこをどう変えるか」
4. **A/Bテストで検証**: 改善前後でスコア比較

---

## 参考文献

### 外部リソース
- [KERNEL Framework - Engify.ai](https://www.engify.ai/patterns/kernel)
- [Prompt Engineering: The KERNEL Framework](https://cybercorsairs.com/the-kernel-prompting-framework/)

### 内部ドキュメント
- [CLAUDE.md](../CLAUDE.md): brainbase開発標準
- [.claude/skills/kernel-prompt-engineering/SKILL.md](../.claude/skills/kernel-prompt-engineering/SKILL.md): KERNEL原則のSkill実装

---

**最終更新**: 2026-03-05
**作成者**: Unson LLC
**ステータス**: Active
