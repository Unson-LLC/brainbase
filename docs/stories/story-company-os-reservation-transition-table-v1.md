---
story_id: story-company-os-reservation-transition-table-v1
title: 予約の状態遷移を1つの表で読めて、表に無い遷移は書き込めない
status: active
created_at: 2026-11-16
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-reservations-v1"]
---

# 予約の状態遷移を1つの表で読めて、表に無い遷移は書き込めない

## 利用者成果

資源の予約を使う開発者とエージェントが、どの操作がどの状態からどの状態へ進めるか、外部操作がどの状態なら通るかを1か所で読める。操作を足したり直したりしたとき、表と食い違う書き込みは保存の前に止まる。

## 背景

`ResourceReservationService` は予約の状態（5つ）と外部操作の状態（4つ）の2軸を持つ。遷移の規則は各操作の `if` と、その場で作る許可状態の配列にだけあった。状態、外部操作、履歴は3か所で別々に書いていた。Specには遷移の一覧が無かった。

## 受入条件

- AC-01: 操作ごとの遷移元・遷移先と、通してよい外部操作の状態・書き込む外部操作の状態を、1つの表（`RESOURCE_RESERVATION_TRANSITIONS`）で公開する。
- AC-02: 承認以外の状態の書き込みは1つの関数を通り、表に無い遷移は `reservation_state_conflict` で拒否する。
- AC-03: 各操作の検査は表を読む。表にある状態の遷移はすべて実際の操作で起こせて、操作が履歴に書く遷移はすべて表にある。
- AC-04: 既存の操作の結果、エラーのコードと文言、検査の順番、保存するJSONの形は変わらない。
- AC-05: Specに表と同じ遷移の一覧がある。

## 対象外

外部操作の `unknown` を書く操作の追加や照合の仕組み。待機（durable-waits）と共通の基盤。ほかのモジュールの遷移表。

## 検証

実際のsidecar storeで全操作を通し、履歴に書かれた状態の遷移の集合と表を両方向で照合する。既存の予約のテストをそのまま通す。
