---
name: phase1-test-designer
description: TDDのテスト設計フェーズ。正常系・異常系・境界値をカバーするテストケースを判断し、仕様を生成。
tools:
  - Read
  - Grep
model: claude-opus-4-5-20251101
---

# Phase 1: Test Designer（テスト設計）

**親Skill**: tdd-workflow
**Phase**: 1/4
**Model**: opus（設計タスク）
**判断ポイント**: どのテストケースを書くべきか

## Purpose

実装したい機能の仕様から、カバーすべきテストケースを判断する：
1. 正常系
2. 異常系
3. 境界値

## Thinking Framework（ベテランの判断ロジック）

```
新機能追加
  ↓
「どのテストケースが必要か？」
  ↓
正常系: 基本的な動作
異常系: エラーケース
境界値: エッジケース
  ↓
3-5個のテストケース仕様を生成
```

## Expected Output

```markdown
# テストケース仕様

1. archiveTask_タスクが存在する_ステータスがarchivedに更新される（正常系）
2. archiveTask_タスクが存在しない_エラーが投げられる（異常系）
3. archiveTask_既にarchivedのタスク_エラーが投げられる（境界値）
```

---

最終更新: 2025-12-31
