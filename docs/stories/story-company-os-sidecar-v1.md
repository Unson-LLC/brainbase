---
story_id: story-company-os-sidecar-v1
title: SSOT sidecar の初回作成と失敗回復を原子的に扱える
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: []
external_dependencies: []
---

# SSOT sidecar の初回作成と失敗回復を原子的に扱える

## 利用者成果

共通 SSOT の利用者として、正本と補助 sidecar を一緒に更新し、初回作成や更新に失敗しても途中状態を読まずに再開したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: `src/ssot.ts` の共通 sidecar 読み書き・transaction recovery と、その直接テスト

このStoryはOSS共通基盤だけを扱う。資源予約、組織固有の認可、予約台帳、package export の追加は含めない。

## 受入条件

- [x] AC-01: `mutatePersonalOsWithSidecar` は既存の1引数 mutator と互換性を保ちつつ、対象 sidecar の直前内容を2番目の引数で受け取れる。未作成なら `undefined` になる。
- [x] AC-02: `readPersonalOsSidecar` は SSOT のlockとtransaction recoveryを経て、未作成なら `undefined`、commit済みならその内容を返す。
- [x] AC-03: 初回 sidecar 作成のpublicationが失敗したとき、canonical 4ファイルを直前状態へ戻し、新しく作った sidecar を残さない。
- [x] AC-04: 既存 sidecar の更新が失敗したとき、canonical 4ファイルと既存 sidecar の内容を直前状態へ戻す。

## 対象外

資源予約ドメインの台帳・容量計算・認可、sidecar の個別schema、外部サービスとの同期、共有保存CRUD、npm package version/export の変更。

## 検証と完了

最小Specは [`docs/specs/company-os-sidecar-v1.md`](../specs/company-os-sidecar-v1.md) に置き、初回作成・読込・失敗rollback fixtureで受入条件を確認済み。PR #523（[merge 7d7da51](https://github.com/Unson-LLC/brainbase/commit/7d7da51047629cb85e3b0a2c4fecf7c0a2210cef)）、[CI 35836983284](https://github.com/Unson-LLC/brainbase/actions/runs/35836983284) pass、focused 22 tests。
