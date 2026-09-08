---
story_id: story-canonical-task-cross-host-evidence-transfer
title: Macの読み取り専用証跡を別hostで再検証する
status: active
date: 2026-09-05
related_specs:
  - docs/specs/story-canonical-task-cross-host-evidence-transfer-spec.md
---

# Macの読み取り専用証跡を別hostで再検証する

Mac consumerの正規read-only結果を、provider runtimeが動くhostで検証できないとcanonical readinessを再検証できない。
元のresult JSONを変更せず、同じGit HEADとraw log hashを持つ運搬snapshotだけを明示指定で受け入れる。

## 完了条件

- `--mac-source-root`指定時だけsnapshotを使い、同一host経路は変えない。
- 元checkout外、path escape、symlink、HEAD/hash不一致を拒否する。
- snapshotがdirtyでもcleanとは主張しない。
