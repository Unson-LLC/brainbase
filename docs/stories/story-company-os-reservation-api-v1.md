---
story_id: story-company-os-reservation-api-v1
title: 信頼できる文脈から資源予約を安全に呼び出せる
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-reservations-v1"]
external_dependencies: []
---

# 信頼できる文脈から資源予約を安全に呼び出せる

## 利用者成果

組織版や別のHTTPホストの開発者として、認証済みのテナント・主体・スコープを予約サービスへ安全に渡し、見積から消費までの資源予約を既存の原子的な正本に対して呼び出したい。ホストごとに予約状態遷移やテナント境界を再実装せず、同じ契約を使えるようにする。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: `ResourceReservationService` を既存HTTPホストへ合成する共通の公開契約

OSSは、HTTP入力の検証、信頼済みリクエスト文脈の受け取り、予約サービスへの委譲、結果と失敗のHTTP表現を所有する。認証・テナント解決・RACI・組織DB・承認規則は呼び出し元が所有し、OSSへ持ち込まない。

## 受入条件

- [x] AC-01: HTTPホストは、信頼済みのテナント・主体・スコープ文脈と、その文脈に束縛された予約サービスを注入して、予約ルートを既存サーバーへ合成できる。
- [x] AC-02: 見積・承認・確保・解放・取消・消費と、現在の認可を経た台帳読取をHTTPから呼び出せる。外部作用開始はこの公開面から呼び出せない。
- [x] AC-03: 本文にテナント・主体・スコープが指定された場合は信頼済み文脈と一致することを検証し、権限主体を表す未契約の`authority`は拒否する。本文の値で認証文脈を上書きしない。
- [x] AC-04: 変更要求は、信頼済みのCSRF／変更元検証結果がない場合に失敗し、Cookie認証だけで状態変更へ進まない。
- [x] AC-05: 不正JSON、入力不足、入力型違反、文脈不一致はサービスを呼び出す前に失敗し、台帳へ副作用を残さない。
- [x] AC-06: 二つのテナントから同じHTTP面を使っても、サービスの現在ACLと既存のロック・冪等性・テナント境界が維持され、実ストアへの予約と読戻しで確認できる。

## 対象外

組織認証、メンバー・役割・承認規則、組織用DB、別常駐HTTPサーバー、`start_external`の公開、外部作用の実行や照合。

## 依存と検証

予約サービスの状態遷移・原子性・実ストアは `story-company-os-reservations-v1` の契約を利用する。HTTP面の入力、認証文脈、CSRF境界、テナント分離、readbackを `tests/resource-reservation-http.test.ts` で確認し、既存予約サービスのテストも再実行した。[PR #532](https://github.com/Unson-LLC/brainbase/pull/532) はmerge [`3c74332`](https://github.com/Unson-LLC/brainbase/commit/3c74332)、[CI 35848463010](https://github.com/Unson-LLC/brainbase/actions/runs/35848463010) passである。組織認証・tenant/RACI本番接続は対象外であり、OSSの公開adapter完了を記録する。
