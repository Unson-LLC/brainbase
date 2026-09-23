---
story_id: story-company-os-world-model-reference-safety-v1
title: sidecarのsupersedes参照とclone安全性を一貫して扱える
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-world-model-v1", "story-company-os-sidecar-v1"]
external_dependencies: []
---

# sidecarのsupersedes参照とclone安全性を一貫して扱える

## 利用者成果

世界モデルの旧版・新版の関係を失わず、特殊なキーを含む入力を複製しても判断用データの意味やプロトタイプを壊さない。

## 対象

- sidecar `supersedes` の参照先、向き、存在性、自己参照・矛盾参照を同じ検証契約で確認する。
- `__proto__` などのown keyを含むオブジェクトのcloneで、プロトタイプ汚染、キー欠落、参照共有を起こさない。
- 失敗を機械可読エラーで返し、保存済みsidecarを変更しない。

## 受入条件

- [ ] 有効なsupersedes chainを正規化後も同じ参照関係としてreadbackでき、dangling・self・向きの不整合を保存前に拒否する。
- [ ] `__proto__` をデータキーとして持つ入力をcloneしてもprototypeの変更やキーの消失がなく、元入力・clone・保存値が相互に変更されない。
- [ ] 失敗時に既存sidecar bytesとdigestが不変で、focused testで再現できる。

## 検証と完了

レビュー追補の登録のみ。新Spec、実装、テスト、review、PR、CI、mergeは未着手である。
