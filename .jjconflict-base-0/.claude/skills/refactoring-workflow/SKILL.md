---
name: refactoring-workflow
description: brainbaseの3-Phase Refactoring戦略への準拠をチェック。既存機能を壊さずに段階的に移行する5ステップを自動化。
---

# Refactoring Workflow

**目的**: brainbaseの3-Phase Refactoring戦略（Infrastructure → Client → Server）への準拠をチェックし、段階的移行を支援

このSkillは、CLAUDE.mdで定義されたリファクタリング原則を自動的に実践し、安全なリファクタリングを実現します。

## Workflow Overview

```
Phase 1: Phaseチェック
└── agents/phase1_phase_checker.md
    └── どのPhaseに属するか判断
    └── Phase順序を守っているか確認

Phase 2: 5ステップチェック
└── agents/phase2_step_checker.md
    └── 新パターン実装、テスト追加、互換性確保、段階的移行、旧コード削除の順序を確認
```

## 5ステップ

1. 新しいパターンで実装
2. テスト追加（カバレッジ80%以上）
3. 互換性確保
4. 段階的移行
5. 旧コード削除

## 参照

- **CLAUDE.md**: `§3 Refactoring Workflow`
- **ドキュメント**: `docs/REFACTORING_PLAN.md`

---

最終更新: 2025-12-31
