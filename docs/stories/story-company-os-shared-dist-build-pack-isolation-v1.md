---
story_id: story-company-os-shared-dist-build-pack-isolation-v1
title: 共有distのbuildとpack競合疑いを調査して隔離する
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: []
external_dependencies: []
---

# 共有distのbuildとpack競合疑いを調査して隔離する

## 利用者成果

buildとpackage検証を同時に実行しても共有 `dist` の中間状態を読み込まず、再現条件と隔離方法を判断できる。

## 根拠と不確実性

- `tests/npm-consumer-smoke.integration.test.ts:37` のroot build、`tests/npm-release-validation.integration.test.ts:46` から `scripts/npm-release.mjs:245` の `npm pack` prepare、`tests/repo-hygiene.test.ts:43` の `npm pack` dry-run prepareが共有 `dist` へ書き込む疑いがある。
- 旧CI 35837694006では `foundation-store.js` のread EOFが出たが、局所package 8 testsと同時実行1回では再現していない。原因は未確定で、現実装の変更根拠にはしない。

## 受入条件

- [ ] build／pack／consumer smokeの共有出力先とprepare経路を列挙し、同時実行時の書込・読込境界を再現可能な形で記録する。
- [ ] read EOFを含む失敗を、決定的な競合・単発失敗・別原因に切り分け、未再現は未確認として残す。
- [ ] 必要な隔離方法をfocused testまたは実行手順で検証し、原因確定前に現実装を変更しない。

## 検証と完了

レビュー追補の登録のみ。新Spec、実装、テスト、review、PR、CI、mergeは未着手である。
