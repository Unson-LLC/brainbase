---
story_id: story-canonical-task-nocodb-project-binding
title: NocoDB正本Taskのプロジェクト紐づけを欠落なく返す
status: active
created_at: 2026-09-15
updated_at: 2026-09-15
view: product
architecture_docs:
  - docs/architecture/story-canonical-task-nocodb-project-binding.md
spec_docs:
  - docs/specs/canonical-task-project-binding.md
development_controller: SIMPLIFICATION
---

# NocoDB正本Taskのプロジェクト紐づけを欠落なく返す

## 背景

Canonical Task APIは`project_codes`を公開契約に持つが、既定のNocoDB repositoryは
その列を読み書きせず、一覧の`project_code`条件も適用していなかった。PostgreSQL実装
だけが契約を満たしており、既定backendではMac Companionのプロジェクト別表示が
正しい根拠を得られない。

## ユーザーストーリー

Brainbaseを組織のTask正本として使う利用者として、Mac Companionでプロジェクト別に
絞り込み・グループ化したとき、NocoDB正本に保存された紐づけと同じ結果を確認したい。

## 受け入れ基準

- [ ] NocoDBの`project_codes`を配列またはJSON文字列から正規化して返す。
- [ ] 移行前の単一プロジェクト列を読み取り互換として維持する。
- [ ] 複数の`project_code`条件はいずれかに一致するTaskを返す。
- [ ] create/updateで指定された`project_codes`をJSON配列として保存する。
- [ ] 情報なしを推測せず、空配列として返す。
- [ ] NocoDB、Service、PostgreSQLの関連回帰が通る。

## 対象外

- 実NocoDBテーブルへの列追加と既存データのbackfill
- PostgreSQL正本への切替
- 本番デプロイ、repository rename、merge

## Development Controller

`SIMPLIFICATION`を選ぶ。公開OSSに未使用のUI抽象を増やさず、既存のCanonical Task契約を
既定NocoDB adapterへ揃える最小変更に限定する。

