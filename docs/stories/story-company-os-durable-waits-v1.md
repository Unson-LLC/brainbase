---
story_id: story-company-os-durable-waits-v1
title: 証拠待ちや期限超過を再起動後も担当へ戻せる
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-problem-snapshot-v1"]
external_dependencies: []
---

# 証拠待ちや期限超過を再起動後も担当へ戻せる

## 利用者成果

運営担当者として、保留した仕事の責任と再開条件をプロセス停止で失いたくない。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 永続責任・待機・claim API

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。

- なし。既存実装との重複は着手時に確認する。

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-problem-snapshot-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [x] AC-01: 証拠／イベント条件・期限または定期見直し・担当・再開方法・条件未達時処置・関連runを保存する。
- [x] AC-02: イベントとタイマーの同時到来は一回の再開claimになり、勝者のrequest/lease/tokenだけが再開できる。lease切れの引継ぎでも重複処理を防ぐ。
- [x] AC-03: 安全な再開と新Problemを要する前提変更を区別し、外部作用不明なら照合待ちへ送る。
- [x] AC-04: 証拠未着の期限超過、worker停止、担当引継ぎを検証し、結果と次の責任を永続化する。

## 対象外

Mana独自の判断規則、外部作用不明runの自動再実行。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

最小Specと永続wait/claim adapterを追加した。`npm run build` と `npx vitest run tests/durable-waits.test.ts`（8 tests）および関連既存テストを検証済み。[PR #534](https://github.com/Unson-LLC/brainbase/pull/534) はmerge [`5e39a99663dae0e9e17443353d028fef3f8b6200`](https://github.com/Unson-LLC/brainbase/commit/5e39a99663dae0e9e17443353d028fef3f8b6200)、[CI 35857188292](https://github.com/Unson-LLC/brainbase/actions/runs/35857188292) success、11 tests・review passである。VibeProの `active` は登録状態を示す既存値として維持する。
