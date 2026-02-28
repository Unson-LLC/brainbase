---
name: test-strategy
description: brainbaseのTest Pyramid（Unit 80% / API 15% / E2E 5%）への準拠をチェック。カバレッジ80%以上、命名規約、テスト品質を自動検証。
---

# Test Strategy

**目的**: brainbaseのTest Pyramid戦略への準拠をチェックし、テスト品質を自動検証

このSkillは、CLAUDE.mdで定義されたTest戦略を自動的に実践し、高品質なテストコードを維持します。

## Workflow Overview

```
Phase 1: Test Pyramidチェック
└── agents/phase1_pyramid_checker.md
    └── Unit / API / E2E の比率を判断
    └── 80% / 15% / 5% に準拠しているか確認

Phase 2: カバレッジチェック
└── agents/phase2_coverage_checker.md
    └── カバレッジ80%以上か確認
    └── カバーされていないファイルを特定

Phase 3: 命名規約チェック
└── agents/phase3_naming_checker.md
    └── describe('対象', () => { it('条件_期待結果', () => {}) })
    └── 命名規約に準拠しているか確認
```

## カバレッジ目標

**80%以上**（Critical）

## 参照

- **CLAUDE.md**: `§2 Test Strategy`

---

最終更新: 2025-12-31
