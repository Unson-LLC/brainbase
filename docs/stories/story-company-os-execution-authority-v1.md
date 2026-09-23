---
story_id: story-company-os-execution-authority-v1
title: 実行直前に失効した権限や不足した資源での操作を止める
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-reservations-v1"]
external_dependencies: []
---

# 実行直前に失効した権限や不足した資源での操作を止める

## 利用者成果

承認者として、過去に承認した判断でも現在の許可範囲を外れる行為は実行させたくない。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 共通の実行開始契約・単独所有者の権限検証port／副作用のない試験adapter

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。

- `src/execution-authority.ts` に、実行直前の4系統の現在検証、revision fence、安定した操作IDを持つ実行意図sidecar、失敗時の照合待ち状態を追加した。
- `ExecutionReadAccessPort` による現在のread ACLを、`readIntent` と started再送の入口へ適用した。最終検証では期限付きfencing capabilityを生成し、`ExecutionEffectPort`へ渡して作用側の開始境界で消費・検証する契約にした。
- `createResourceReservationExecutionPort` で既存 `ResourceReservationService` の現在台帳読出しと `startExternalAction` を接続した。execution sidecarのcallback内から予約storeへ再入せず、予約開始を別transactionとして扱う。
- `ExecutionEffectPort` は副作用のないportとし、Mana側へ同じ `operationId` を渡せる契約にした。`package.json` の `./execution-authority` subpathから公開する。

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-reservations-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [x] AC-01: 副作用のない試験adapterで、現在のauthority・承認scope・制約・確保状態を実行開始契約が再検証する。提供者portは失効・不明を返せる。
  - 検証根拠: `tests/execution-authority.test.ts` の「revalidates all current providers...」「fails closed when the current ... provider is ...」および予約adapter検証。
- [x] AC-02: 承認後の失効、scope変更、期限切れ、資源競合を拒否し、元の判断と承認証跡は保持する。
  - 検証根拠: 同テストの失効・期限切れ・不明・revision競合・scope変更の反例。意図のinitial/final検証とfailureを実Storeから読戻す。
- [x] AC-03: 判断結果から直接外部作用を起こす迂回経路を作らず、実行意図と安定した操作IDを作用前に永続化する。
  - 検証根拠: 同テストの作用前sidecar保存、started再試行の作用1回、`ExecutionEffectPort`への安定operationId伝播。実作用はportの外部境界に残す。
- [x] AC-04: 実行開始と権限変更の競合境界をSpecで定め、取消不能な開始済み作用を未実行扱いに戻さない。
  - 検証根拠: `docs/specs/company-os-execution-authority-v1.md` のrevision fence・予約開始線形化点・recovery/unknown契約、および同テストの予約印不明・作用不明の再試行拒否。

## 対象外

すべての外部connector移行、本番外部送信。 組織のRACI／メンバー管理、実際の外部Action送信（Mana所有）。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

AC-01〜04は、`npm run build` と `npx vitest run tests/execution-authority.test.ts`（12 tests）、および実装した予約adapterの検証で確認済みである。実装はOSS共通portと副作用のないadapterまでで、組織provider、Manaの実作用、tenant/RACIの本番接続は未確認・対象外である。[PR #530](https://github.com/Unson-LLC/brainbase/pull/530) はmerge [`b08e96f`](https://github.com/Unson-LLC/brainbase/commit/b08e96f)、[CI 35847575227](https://github.com/Unson-LLC/brainbase/actions/runs/35847575227) passである。
