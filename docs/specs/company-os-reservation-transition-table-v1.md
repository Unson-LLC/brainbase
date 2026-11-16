# Reservation transition table v1

対象Story: [`story-company-os-reservation-transition-table-v1`](../stories/story-company-os-reservation-transition-table-v1.md)

このSpecは [`company-os-reservations-v1`](./company-os-reservations-v1.md) の保存契約と操作の結果を変えない。遷移の規則の置き場を1つにする。

## 表

`src/resource-reservations.ts` の `RESOURCE_RESERVATION_TRANSITIONS` が正本。キーは履歴の `action`。

| 操作 | 遷移元 | 遷移先 | 通してよい外部操作の状態 | 書き込む外部操作の状態 |
|---|---|---|---|---|
| `approve` | （記録なし） | `approved` | （記録なし） | `not_started` |
| `reserve` | `approved` | `reserved` | すべて | 変えない |
| `release` | `approved`、`reserved` | `released` | `not_started`、`completed` | 変えない |
| `cancel` | `approved`、`reserved` | `cancelled` | `not_started`、`completed` | 変えない |
| `consume` | `reserved` | `consumed` | すべて | `completed` |
| `start_external` | `reserved` | `reserved` | `not_started` | `started` |

- `released`、`cancelled`、`consumed` から出る遷移は無い。
- 外部操作の `unknown` を書く操作はこのモジュールに無い。保存済みの台帳にあれば読み、`release` と `cancel` を止める。
- 外部操作が `completed` になるのは `consume` だけで、同時に予約は `consumed` になる。そのため `release` と `cancel` が `completed` を通す経路は、通常の操作では起きない。これまでの検査と同じ範囲を表に写した。

## 不変条件

- 承認以外の状態の書き込みは `transitionResourceReservation` だけが行う。`state`、`updatedAt`、`externalAction`、履歴の `fromState`・`toState`・`externalActionStatus` は1回の呼び出しの同じ値から作る。
- `transitionResourceReservation` は、現在の状態か外部操作の状態が表の範囲に無いとき `ResourceReservationError('reservation_state_conflict')` を投げ、記録を変えない。
- 各操作の既存の検査は表を読み、この関数より前に同じ順番・同じコード・同じ文言で失敗する。
- 表は凍結した値で、実行時に書き換えられない。

## 検証

```bash
npx vitest run tests/resource-reservation-transitions.test.ts tests/resource-reservations.test.ts tests/resource-reservation-http.test.ts tests/execution-authority.test.ts
```

| AC | 最小シナリオ |
|---|---|
| AC-01 | 表が6つの操作をすべて持ち、凍結されている |
| AC-02 | 表の外の遷移を `transitionResourceReservation` が拒否し、記録を変えない |
| AC-03 | 実際のserviceで起こした履歴の状態の遷移の集合が、表を展開した集合と一致する |
| AC-04 | 既存の予約まわりのテストが変更なしで通る |
| AC-05 | `company-os-reservations-v1` から表へ辿れる |
