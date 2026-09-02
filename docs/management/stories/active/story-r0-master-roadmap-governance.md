---
story_id: story-r0-master-roadmap-governance
title: R0 OSSロードマップをProgram Masterへ従属させる
status: active
category: governance
spec: docs/specs/r0-master-roadmap-governance.md
architecture: docs/architecture/story-r0-master-roadmap-governance.md
canonical_story_path: docs/management/stories/active/story-r0-master-roadmap-governance.md
created_at: 2026-09-02
updated_at: 2026-09-02
---

# R0 OSSロードマップをProgram Masterへ従属させる

## Intent

Brainbase OSSの実装者として、OSS component roadmapがProgram Masterの依存順・完了条件・共通statusを、再現可能な固定revisionから参照してほしい。これにより、同名のcomponent-local milestoneをProgram全体の順序と誤認せず、文書変更や部分証跡を実装完了へ昇格させない。

## 受け入れ基準

- [x] AC-001: component roadmapはProgram Masterのrepository、Markdown/JSON path、exact commit、両content SHA-256を明示する。
- [x] AC-002: `contracts/judgment-dag/source-lock.json`はR0 / J0 / G0 / R1 / D0 / P0 / C0のcrosswalkと6つのstatus vocabularyをmachine-readableに固定する。
- [x] AC-003: focused testはroadmap表示面とsource-lock機械面のcommit、path、hash、crosswalk、statusを同時に検証する。
- [x] AC-004: public contract generatorは更新したroadmapとsource-lockをdigestへ含め、再計算後のhash整合を検証する。
- [x] AC-005: public testや配布物は参照元repoへのnetwork accessを要求せず、固定snapshotの更新は新しいcommit・両artifact hash・検証証跡・独立reviewを必須とする。
- [x] AC-006: 文書merge、focused test、contract_readyをアプリケーション/production実証またはProgram work packageの`done`として扱わない。

## 境界

- OSS Judgment DAGのアプリケーション実装面、公開型、schema、fixtureの意味は変更しない。
- Program Masterの現在statusを書き戻さず、受理したsnapshotへの参照だけを固定する。
- `brainbase-unson`の内容をOSS packageへ複製せず、commitとcontent hashだけを公開契約へ載せる。
- push、PR、merge、package公開、deploy、機密設定、production readbackはこのローカル変更の非目標とする。

## 完了証拠

Story、Architecture、accepted Spec、Task、Graphify/diagnosis、生成済みcontract digest、focused test、docs check、build、typecheck、独立reviewを同一HEADへ結び付ける。full suiteと公開・本番証拠は観測結果どおりに分離して報告する。
