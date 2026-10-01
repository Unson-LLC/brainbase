---
story_id: story-ux-20261001-03-graph-correction-guidance
title: Graphの訂正の流れを押下前に理解できる
status: active
created_at: 2026-10-01
implementation_started: true
owner_repository: brainbase
depends_on: ["story-local-web-graph-screens-v1"]
external_dependencies: []
---

# Graphの訂正の流れを押下前に理解できる

## 利用者成果

手元のGraphで記録または関係の誤りを見つけた利用者が、編集ボタンを押す前に変更案を作る入口と、保存後に何が確認され、次のMCP読取にいつ使われるかを理解できる。

## 受入条件

- [ ] AC-01: 「情報と関係」で記録を選ぶと、利用できる訂正操作の前に「訂正の流れ」を表示し、記録・関係の変更案を作る入口を実際のボタン名で示す。
- [ ] AC-02: 案内は、承認待ちの提出段階を置かず、保存時にその場でGraphへ反映されること、理由と変更前後が履歴に残ること、保存後に読み直して一致を確かめること、確認できた内容が次のMCPの `search`・`get_context`・`resolve_entity` で使われることを説明する。
- [ ] AC-03: `canCorrect: false` またはホストが訂正範囲を絞った場合、利用できない入口を案内せず、既存の読み取り専用案内を保つ。
- [ ] AC-04: 承認キュー・新しい提案API・Graphスキーマ・ホストの反映経路は追加しない。

## 対象外

変更内容の入力、保存、競合解決、承認者の追加、実提出のプロトコル変更は対象外とする。既存の直接保存・保存後読戻し・履歴記録を説明するだけに留める。

## 検証

- `tests/ui/graph-registry-view.test.mjs` で既存の人物記録を開き、編集ボタンを押す前に案内・訂正入口・保存後の扱いが表示され、編集フォームはまだ表示されないことを確認する。
