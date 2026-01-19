---
name: architecture-patterns
description: brainbaseのアーキテクチャパターン（EventBus、Reactive Store、DI Container、Service Layer）への準拠をチェックし、違反箇所を修正提案する4 Phase Orchestrator Skill。
---

# Architecture Patterns Checker

**目的**: brainbaseの4つのアーキテクチャ原則への準拠をチェックし、違反箇所を検出して修正提案を行う

このSkillは、CLAUDE.mdで定義されたアーキテクチャパターンへの準拠を自動的にチェックし、ベテラン開発者の判断ロジックを外付け化します。

## Workflow Overview

```
Phase 1: EventBus パターンチェック
└── agents/phase1_eventbus_checker.md
    └── Event発火が適切か判断
    └── Event名が規約に準拠しているか判断
    └── 直接呼び出しのアンチパターンを検出

Phase 2: Reactive Store パターンチェック
└── agents/phase2_store_checker.md
    └── Store経由で状態更新しているか判断
    └── DOM直接操作のアンチパターンを検出
    └── 状態管理の一元化を確認

Phase 3: DI Container パターンチェック
└── agents/phase3_di_checker.md
    └── サービス間の依存がDI経由か判断
    └── 直接importのアンチパターンを検出
    └── 循環依存を検出

Phase 4: Service Layer パターンチェック
└── agents/phase4_service_layer_checker.md
    └── ビジネスロジックがServiceレイヤにあるか判断
    └── UI Component肥大化を検出
    └── レイヤ分離を確認
```

## ベテランと新人の差（思考の外付け化）

### ベテラン開発者の判断
- 「この状態変更はEventを発火すべき」→ EventBus使用
- 「この依存はDI Containerで解決すべき」→ 直接import回避
- 「このロジックはServiceレイヤに配置すべき」→ UI Componentから抽出

### 新人開発者の判断
- 「直接呼び出しでいいかな」→ 密結合のアンチパターン
- 「とりあえずDOM操作」→ 状態とDOMの分離なし
- 「UI Componentに全部書く」→ ビジネスロジックが散在

→ **このSkillでベテランの判断ロジックを再現**

## 判断による分岐例

```
コード読み込み
  ↓
Phase 1: EventBus チェック
  ↓ Event発火なし
  ├─→ [修正提案: EventBus使用] をQueueに追加 → Phase 5へ
  ↓ Event発火あり
Phase 2: Store チェック
  ↓ DOM直接操作あり
  ├─→ [修正提案: Store経由に変更] をQueueに追加 → Phase 5へ
  ↓ Store経由
Phase 3: DI チェック
  ↓ 直接import あり
  ├─→ [修正提案: DI Container使用] をQueueに追加 → Phase 5へ
  ↓ DI経由
Phase 4: Service Layer チェック
  ↓ UI Component肥大化
  ├─→ [修正提案: Serviceレイヤに抽出] をQueueに追加 → Phase 5へ
  ↓ レイヤ分離OK
Phase 5: 統合レポート生成
```

→ **各Phaseで判断し、動的にQueueに積む** = Agenticにする価値がある

## Orchestration Logic

### Phase 1: EventBus パターンチェック

**Subagent**: `agents/phase1_eventbus_checker.md`

**Input**:
- チェック対象のファイルパス（または現在の変更）

**Process**:
1. 状態変更コードを検出
2. EventBus使用を確認
   - `eventBus.emit()` が呼ばれているか
   - Event名が規約に準拠しているか（`EVENTS.TASK_COMPLETED`等）
3. アンチパターン検出
   - 直接呼び出し（`taskService.onComplete()`等）
   - Event名のハードコーディング

**Output**:
- 違反箇所のリスト
- 修正提案

### Phase 2: Reactive Store パターンチェック

**Subagent**: `agents/phase2_store_checker.md`

**Input**: Phase 1の結果（オプション）

**Process**:
1. 状態更新コードを検出
2. Store使用を確認
   - `appStore.setState()` が呼ばれているか
   - `appStore.subscribe()` でUI更新しているか
3. アンチパターン検出
   - DOM直接操作（`document.getElementById().textContent =`）
   - 状態とDOMの分離なし

**Output**:
- 違反箇所のリスト
- 修正提案

### Phase 3: DI Container パターンチェック

**Subagent**: `agents/phase3_di_checker.md`

**Input**: Phase 2の結果（オプション）

**Process**:
1. サービス間の依存を検出
2. DI Container使用を確認
   - `container.get('serviceName')` が呼ばれているか
   - サービス登録が適切か
3. アンチパターン検出
   - 直接import（`import { taskService } from './services/task.js'`）
   - 循環依存

**Output**:
- 違反箇所のリスト
- 修正提案

### Phase 4: Service Layer パターンチェック

**Subagent**: `agents/phase4_service_layer_checker.md`

**Input**: Phase 3の結果（オプション）

**Process**:
1. ビジネスロジックの配置を確認
2. レイヤ分離を確認
   - ビジネスロジックがServiceレイヤにあるか
   - UI Componentが肥大化していないか（200行以上）
   - データアクセスがRepositoryレイヤにあるか
3. アンチパターン検出
   - UI Componentにビジネスロジック
   - Serviceレイヤにデータアクセス

**Output**:
- 違反箇所のリスト
- 修正提案

### 統合・検証

**Orchestratorの責任**:
- 各Phaseの完了を確認
- 違反が見つかった場合、修正提案をQueueに追加
- 全Phaseの結果を統合してレポート生成
- 優先度付け（Critical > Warning > Info）

## Success Criteria

- [ ] Phase 1 EventBus チェックが完了
- [ ] Phase 2 Reactive Store チェックが完了
- [ ] Phase 3 DI Container チェックが完了
- [ ] Phase 4 Service Layer チェックが完了
- [ ] 違反箇所が検出された
- [ ] 修正提案が生成された
- [ ] 統合レポートが生成された

## Expected Output

```markdown
# Architecture Patterns チェック結果

## ❌ Critical（必須修正）

### EventBus: 直接呼び出しのアンチパターン
- **ファイル**: `public/modules/domain/task/task-view.js:45`
- **違反**: `taskService.onComplete(taskId)` （直接呼び出し）
- **修正提案**:
  ```javascript
  // Bad: 直接呼び出し
  taskService.onComplete(taskId);

  // Good: EventBus経由
  eventBus.emit(EVENTS.TASK_COMPLETED, { taskId });
  ```

## ⚠️ Warning（推奨修正）

### Reactive Store: DOM直接操作
- **ファイル**: `public/modules/views/session-list.js:78`
- **違反**: `document.getElementById('session').textContent = 'brainbase'`
- **修正提案**:
  ```javascript
  // Bad: DOM直接操作
  document.getElementById('session').textContent = 'brainbase';

  // Good: Store経由
  appStore.setState({ currentSessionId: 'brainbase' });
  ```

## ✅ 合格

- Phase 3 DI Container: 違反なし
- Phase 4 Service Layer: 違反なし

## サマリー

- **総チェック項目**: 12
- **Critical**: 1件
- **Warning**: 1件
- **合格**: 10件

## 推奨アクション

1. EventBus: task-view.js:45 を修正（Critical）
2. Reactive Store: session-list.js:78 を修正（Warning）
```

## 使い方

```bash
# 全ファイルをチェック
/architecture-patterns

# 特定のファイルをチェック
/architecture-patterns public/modules/domain/task/task-service.js

# 現在の変更をチェック（git diff）
/architecture-patterns --changed-only
```

## Troubleshooting

### Subagentsが起動しない

**原因**:
- セッション再起動が未実施
- Subagent定義ファイルのフォーマットエラー

**対処**:
1. Claude Codeセッションを再起動
2. Subagentファイルの存在確認
   ```bash
   ls -la /Users/ksato/workspace/.claude/skills/architecture-patterns/agents/
   ```

### 誤検出が多い

**原因**:
- パターンマッチングが厳しすぎる
- コンテキストを考慮していない

**対処**:
- Subagentの判断ロジックを調整
- ホワイトリスト（除外ファイル）を追加

## 参照

- **CLAUDE.md**: `§1 Architecture Principles`
- **Skills**: なし（独立動作）
- **Model**: sonnet（全Phase）

---

最終更新: 2025-12-31
brainbase開発ワークフロー自動化
