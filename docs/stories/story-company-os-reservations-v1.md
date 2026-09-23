---
story_id: story-company-os-reservations-v1
title: 並行した判断でも同じ資源を二重に確約しない
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-sidecar-v1", "story-company-os-problem-snapshot-v1"]
external_dependencies: []
---

# 並行した判断でも同じ資源を二重に確約しない

## 利用者成果

資源の責任者として、複数runが同時に承認済み資源を取り合っても容量を超えないようにしたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 単独所有者の資源台帳・原子的確保APIと、組織adapterが渡すscope／認可結果の共通契約

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。

- `src/resource-reservations.ts` に、見積・承認・確保・解放・取消・消費と台帳読戻しを持つ公開サービスを追加した。
- `src/ssot.ts` の既存lock/transactionを使うJSON sidecarへ保存し、Problem snapshotは `problem_snapshot_id`、`problem_id`、`revision` の参照だけを保持する。
- `createResourceReservationProblemSnapshotPort` でStory05の実Storeローダーを接続し、固定参照とscopeを検証する。

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-sidecar-v1`
- `brainbase / story-company-os-problem-snapshot-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [x] AC-01: 見積・承認・予約・消費を分け、所有範囲・資源・期間・単位・run・承認根拠を台帳に記録する。
  - 検証根拠: `tests/resource-reservations.test.ts` の「keeps estimate, approval, reservation and consumption distinct in the persistent ledger」。
- [x] AC-02: 10時間に対し8時間ずつの同時確保は一方だけ成功することを、実際のローカル永続storeで検証する。
  - 検証根拠: 同テストの「serializes two processes against the same store...」。`tests/resource-reservations.worker.ts` を2プロセスで起動し、8+8に対して一方を `capacity_exceeded` とする。
- [x] AC-03: 確保・解放・取消・消費は原子的で履歴が残り、同じ操作IDの再試行で量が増えない。
  - 検証根拠: 同テストの永続台帳・履歴・idempotent retry検証と、`tests/ssot-atomic.test.ts` のsidecar rollback検証。
- [x] AC-04: 承認失効・容量不明・越境操作を拒否し、外部作用開始済みの確保は期限だけで解放しない。
  - 検証根拠: 同テストの「rejects expired approval, unknown capacity, and cross-principal or cross-tenant mutations」および「does not release a reservation after an external action has started」。

## 対象外

外部会計や契約台帳の置換、外部結果の自動照合。 組織予算・役割・承認ワークフローの実装、組織用DBの新設。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

対象検証は `npm run build` と `npx vitest run tests/resource-reservations.test.ts`（9 tests）を実行済み。Problem snapshot portは、永続JSONを読むローダーを接続した同テストで、principalを渡して固定snapshotとscopeを照合するところまで確認した。sidecarの初回作成・rollbackは依存Storyの `tests/ssot-atomic.test.ts`、Problem snapshotの保存・参照は依存Storyの `tests/judgment-problem-snapshot.test.ts` が提供する契約として扱う。PR #528（[merge 25e97fb](https://github.com/Unson-LLC/brainbase/commit/25e97fb1e2778f60d9749f75611fcd0ecff0c78e)）、[CI 35837800344](https://github.com/Unson-LLC/brainbase/actions/runs/35837800344) pass、9 testsとreview pass。
