---
story_id: story-company-os-execution-registration-v1
title: 実行の登録を、帰属付きで差し替え可能な保存先へ残し、同じ実行IDで読み戻す
status: in_progress
created_at: 2026-10-01
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-execution-authority-v1", "story-company-os-execution-authority-http-v1"]
external_dependencies: []
---

# 実行の登録を、帰属付きで差し替え可能な保存先へ残し、同じ実行IDで読み戻す

## 利用者成果

組織の実行hostとして、外部作用を自分では持たずに実行を登録したい。登録には、受付、現在の権限・承認・制約・予約の再検査、予約の開始印、許可（capability）の発行までを含める。登録の記録には、本人、代行サービス、委任、相関IDを残す。記録は自分の保存先（組織ならPostgreSQL）に置き、同じ実行IDで読み戻したい。外部作用の結果は、作用を持つ側から後で受け取りたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: `@unson/brainbase-mcp/execution-authority` と `@unson/brainbase-mcp/execution-authority-http`

認証、tenant・本人・委任の検証、PostgreSQLのアダプター、外部作用はこのStoryの範囲外とする。hostは、帰属を信頼済み文脈として渡し、保存先をportとして差し込む。

## 受入条件

- [ ] AC-01: `register` は、`start` と同じ受付・2段の検査・予約の開始印を行う。外部作用portは呼ばず、状態を `registered` にして許可を返す。`registered` を外部作用の成功として扱わない。
- [ ] AC-02: 外部作用を持つ側は、許可のdigestを添えて、同じ実行IDで `started` または `unknown` を報告できる。報告は冪等で、`started` の後に `unknown` へ戻せない。digestが違えば拒否する。
- [ ] AC-03: 帰属（本人のみ／本人の代行サービス／サービス自身、代行サービス、委任、相関ID）は、serviceのoptionsとHTTPの信頼済み文脈からだけ受け取る。検査portと許可へ渡し、記録へ残す。同じ実行IDで帰属が違う再送は拒否する。HTTPの本文に帰属を書けば拒否する。
- [ ] AC-04: 実行記録の保存先はportとして差し込める。既定はこれまでのsidecarで、既存の振る舞いは変わらない。保存先が使えない場合は、`store_unavailable` を返して予約の開始印に進まない。別の台帳へ切り替えない。
- [ ] AC-05: 同じ実行IDでの再送は、有効期限内なら保存済みの許可を返し、予約の開始印を二度付けない。読み出しの結果には、許可の中身（fencing token）を含めない。

## 対象外

予約の保存先の差し込み口、組織のPostgreSQLアダプター、委任の検証、Manaの呼出経路、bb.unson.jpへの登録（brainbase-project ADR-013 E1のとおり、組織版の組み立てへ移した後に行う）。

## 検証と完了

`tests/execution-registration.test.ts` と `tests/execution-authority-http.test.ts` の契約テスト、`npm run build` を実行する。組織の保存先と認証はテストのfixtureで代用しており、提供済みとは扱わない。
