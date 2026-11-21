---
story_id: story-company-os-durable-wait-transition-table-v1
title: 待機の状態遷移を1つの表で読めて、表に無い遷移は書き込めない
status: active
created_at: 2026-11-16
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-durable-waits-v1"]
---

# 待機の状態遷移を1つの表で読めて、表に無い遷移は書き込めない

## 利用者成果

待機（Durable Wait）を使う開発者とエージェントが、どの操作がどの状態からどの状態へ進めるかを1か所で読める。操作を足したり直したりしたとき、表と食い違う遷移は保存の前に止まる。

## 背景

`DurableWaitStore` は8つの状態と7つの操作を持つが、遷移の規則は各操作の `if` の並びにだけあった。状態、履歴の `to_state`、更新時刻は7か所で別々に書いていた。Specの状態図はコードが書く遷移のうち4本を欠き、`failed` と `cancelled` はどの操作も書かないのに図にあった。

## 受入条件

- AC-01: 操作ごとの遷移元と遷移先を1つの表（`DURABLE_WAIT_TRANSITIONS`）で公開する。
- AC-02: 作成以外の状態の書き込みは1つの関数を通り、表に無い遷移は `state_conflict` で拒否する。
- AC-03: 表にある遷移はすべて実際の操作で起こせて、操作が履歴に書く遷移はすべて表にある。
- AC-04: 既存の操作の結果、エラーのコードと文言、保存するJSONの形は変わらない。
- AC-05: Specの状態図は表と一致する。

## 対象外

`failed` と `cancelled` の型からの削除や、それらへ進む操作の追加。ほかのモジュール（予約、招待、昇格、知識の継続、実行の意図、自動実行）の遷移表。共通のステートマシン基盤。

## 検証

実際のsidecar storeで全操作を通し、履歴に書かれた遷移の集合と表を両方向で照合する。既存の待機のテストをそのまま通す。
