---
story_id: story-company-os-sidecar-v1
title: SSOT sidecar の初回作成と失敗回復を原子的に扱える
status: in_progress
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

- [ ] AC-01: `mutatePersonalOsWithSidecar` は既存の1引数 mutator と互換性を保ちつつ、対象 sidecar の直前内容を2番目の引数で受け取れる。未作成なら `undefined` になる。
- [ ] AC-02: `readPersonalOsSidecar` は SSOT のlockとtransaction recoveryを経て、未作成なら `undefined`、commit済みならその内容を返す。
- [ ] AC-03: 初回 sidecar 作成のpublicationが失敗したとき、canonical 4ファイルを直前状態へ戻し、新しく作った sidecar を残さない。
- [ ] AC-04: 既存 sidecar の更新が失敗したとき、canonical 4ファイルと既存 sidecar の内容を直前状態へ戻す。

## 対象外

資源予約ドメインの台帳・容量計算・認可、sidecar の個別schema、外部サービスとの同期、共有保存CRUD、npm package version/export の変更。

## 検証と完了

最小Specは [`docs/specs/company-os-sidecar-v1.md`](../specs/company-os-sidecar-v1.md) に置く。`tests/ssot-atomic.test.ts` の初回作成・読込・失敗rollback fixtureで受入条件を確認し、`npm run build` と対象テストを実行する。full suite、push、PR、mergeはこのStoryの実装担当の完了条件に含めない。
