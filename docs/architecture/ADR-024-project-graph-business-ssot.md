---
adr_id: ADR-024
title: Project business metadata is canonical in Graph
status: accepted
date: 2026-09-06
related_stories:
  - story-project-provisioning-v1
  - story-phase03-project-catalog-graph-subject
related_docs:
  - docs/architecture/story-project-provisioning-v1.md
  - docs/brainbase-capabilities/capabilities/project.catalog.yml
  - docs/brainbase-capabilities/capabilities/graph.ssot.yml
supersedes: []
superseded_by: []
---

# ADR-024: プロジェクトの業務情報はGraphを正本にする

## 背景

`project_registry`とGraphのProject entityが、ともに名称・種別・状態・所有者を保持し、別々の経路から更新できていた。さらに`projects.id`をProject entity IDとして自動生成する汎用writerがあり、`project_code`をIDとする正式Project entityとの重複も発生した。

## 決定

- Projectの名称、種別、状態、組織entity、所有者、catalog versionはGraphを正本とする。
- `projects`はDB内の認可・保存scope、`project_registry`は組織membership、repository設定、Graph IDとの対応を管理する技術台帳とする。
- `project_registry`の業務項目は互換用の読取projectionであり、Graph更新時にDB triggerで同期する。独立した手入力の正本にはしない。
- 新規ProjectはProject Provisioningだけが、技術scope・Registry binding・Graph subjectを一つのtransactionで作成する。汎用Graph writerは未知のProjectを自動登録しない。
- 正式なGraph identityは`project_registry.graph_entity_id`で参照する。移行時に一意に判定できる旧技術IDのsubjectだけを統合し、候補が複数なら`ambiguous`として停止する。
- 統合時はEdgeを正式subjectへ付け替え、旧subjectを削除せず`merged`にする。

## 完了条件

組織別CatalogはRegistryのmembershipとGraphの業務情報を結合して読み、未接続・曖昧な行を成功や0件として返さない。本番移行はdry-run、transaction適用、commit後の再読込、認証済みAPI読戻しを別々に記録する。
