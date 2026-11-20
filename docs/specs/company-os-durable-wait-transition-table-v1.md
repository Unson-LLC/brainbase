# Durable wait transition table v1

対象Story: [`story-company-os-durable-wait-transition-table-v1`](../stories/story-company-os-durable-wait-transition-table-v1.md)

このSpecは [`company-os-durable-waits-v1`](./company-os-durable-waits-v1.md) の保存契約と操作の結果を変えない。遷移の規則の置き場を1つにする。

## 表

`src/durable-waits.ts` の `DURABLE_WAIT_TRANSITIONS` が正本。キーは履歴の `action`。

| 操作（履歴の action） | 遷移元 | 遷移先 |
|---|---|---|
| `create` | （記録なし） | `waiting` |
| `claim` | `waiting`、`claimed` | `claimed` |
| `handoff` | `claimed` | `claimed` |
| `resume` | `claimed` | `resumed` |
| `premise_changed` | `waiting`、`claimed`、`handoff_required` | `handoff_required` |
| `effect_unknown` | `waiting`、`claimed`、`handoff_required`、`reconciliation_wait` | `reconciliation_wait` |
| `effect_reconciled` | `reconciliation_wait` | `effect_confirmed`、`waiting`、`reconciliation_wait` |

- `claim` の遷移元にある `claimed` は、claimの情報を持たない `claimed` の記録だけが通る。通常の操作ではこの記録は作られない。手で直したledgerが動かせなくなるのを避けるため、これまでの動作を残す。
- `resumed`、`effect_confirmed`、`failed`、`cancelled` から出る遷移は無い。
- `failed` と `cancelled` へ進む操作は無い。型と保存済みledgerの読み取りには残す。

## 不変条件

- 作成以外の状態の書き込みは `transitionWait` だけが行う。`state`、`updated_at`、履歴の `from_state` と `to_state` は1回の呼び出しの同じ値から作る。
- `transitionWait` は、現在の状態が操作の遷移元に無いとき、または遷移先が操作の遷移先に無いとき、`DurableWaitError('state_conflict')` を投げる。各操作の既存の検査はこの関数より前にあり、そのコードと文言を変えない。
- 表は凍結した値で、実行時に書き換えられない。

## 検証

```bash
npx vitest run tests/durable-wait-transitions.test.ts tests/durable-waits.test.ts tests/durable-wait-http.test.ts tests/company-os-impact-review-durable-wait.integration.test.ts
```

| AC | 最小シナリオ |
|---|---|
| AC-01 | 表が7つの操作をすべて持ち、凍結されている |
| AC-02 | 表の外の遷移を `transitionWait` が `state_conflict` で拒否する |
| AC-03 | 実際のstoreで起こした履歴の遷移の集合が、表を展開した集合と一致する |
| AC-04 | 既存の待機のテスト42件が変更なしで通る |
| AC-05 | `company-os-durable-waits-v1` の状態図を読み取って展開した遷移の集合が、表を展開した集合と一致する |
