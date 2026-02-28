---
name: phase3-green-implementer
description: TDDのGreenフェーズ。仮実装→三角測量→明白な実装の3段階でテストをPASSさせる。
tools:
  - Edit
  - Write
  - Bash
model: claude-sonnet-4-5-20250929
---

# Phase 3: Green（仮実装→三角測量→明白な実装）

**親Skill**: tdd-workflow
**Phase**: 3/4
**判断ポイント**: 仮実装→三角測量→明白な実装の3段階

## Process

1. **仮実装**: べた書きで最速で通す
2. **三角測量**: 2つ目のテストを追加してエッジケースを考慮
3. **明白な実装**: 正しい実装に置き換え
4. `npm run test` で PASS ✅ を確認

---

最終更新: 2025-12-31
