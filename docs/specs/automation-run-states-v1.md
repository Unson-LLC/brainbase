# Automation run states v1

対象Story: [`story-automation-run-states-v1`](../stories/story-automation-run-states-v1.md)

`src/automation-run.ts` の `AutomationRunService` が、外部の実行（runner）を1回だけ呼ぶために runStore と lifecycle の2つのportへ書く段階を定める。状態はコアに保存されない。記録を持つのは利用側の runStore で、コアは決まった順で port を呼ぶ。

## 段階の語彙

| 語彙 | 値 | 持ち主 |
|---|---|---|
| runStore の `status` | `in_progress`、`retryable`、`uncertain`、`completed`（記録が無ければ `missing`） | 利用側の runStore |
| runStore の `phase`（`AutomationRunPhase`） | `claimed`、`runner_started`、`receipt_persisted`、`completed`、`retryable`、`uncertain`、`unknown` | 利用側の runStore。コアは `release` に渡す |
| host の lifecycle phase | `prepared`、`claimed`、`runner_started`、`receipt_persisted`、`completed` | 利用側の lifecycle port |

## 保存された記録の遷移

記録は `status(phase)` で書く。`(new)` は記録が無い状態。runStore の各呼び出しが成功したとき、または呼び出しが記録を書いた後に応答を失ったときに、記録は次のように動く。

```text
claim:                (new) -> in_progress(claimed)
markRunnerStarted:    in_progress(claimed) -> in_progress(runner_started)
markReceiptPersisted: in_progress(runner_started) -> in_progress(receipt_persisted)
complete:             in_progress(receipt_persisted) -> completed(completed)
release:              in_progress(claimed), in_progress(runner_started), in_progress(receipt_persisted) -> uncertain(unknown)
release:              in_progress(runner_started) -> uncertain(runner_started)
```

`tests/stage3c-runtime.test.ts` が、成功と各段階の失敗を memoryRunStore で通し、記録が動いた遷移の集合とこの図の展開が一致することを確かめる。

- `claim` は、記録が `completed` なら `replay`、`in_progress` なら `in_progress`、`uncertain` なら `conflict` を返し、記録を動かさない。fingerprint・operation・namespace が違えば `conflict`（`identity_mismatch`）を返す。
- `release` は、記録が `in_progress` で claimToken が一致するときだけ記録を動かす。`complete` が記録を書いた後の読み直しや lifecycle の遷移で失敗したときもコアは `release` を呼ぶが、記録は `completed` のまま動かない。
- コアは `uncertain` の記録を自動で `retryable` に戻さない。照合は利用側の仕事である。

## 失敗したときの `release`

コアは失敗した時点の段階を見て `release` の `outcome` と `phase` を決める（`src/automation-run.ts` の catch）。

| 失敗した場所 | runner | `release` |
|---|---|---|
| `lifecycle.checkpoint` | 呼んでいない | `uncertain`、`unknown` |
| `runStore.markRunnerStarted` | 呼んでいない | `uncertain`、`unknown` |
| `lifecycle.transition`（`claimed → runner_started`） | 呼んでいない | `uncertain`、`unknown` |
| runner、受領記録の正規化、`receipt.persist` | 呼んだ | `uncertain`、`runner_started` |
| `runStore.markReceiptPersisted` | 呼んだ | `uncertain`、`unknown` |
| `lifecycle.transition`（`runner_started → receipt_persisted`） | 呼んだ | `uncertain`、`unknown` |
| `runStore.complete` | 呼んだ | `uncertain`、`unknown` |
| `complete` の後の読み直し、`lifecycle.transition`（`receipt_persisted → completed`） | 呼んだ | `uncertain`、`unknown`（記録は `completed` のまま） |

`uncertain` の記録への次の `start` は `automation_run_uncertain`（409）で止まり、runner を呼ばない。

### 現状（2026-11-20）

- `retryable` には、どの経路からも進まない。catch は段階が `claimed` のときだけ `retryable` を選ぶが、`checkpoint` と `markRunnerStarted` を呼ぶ直前に段階を `unknown` にしているため、catch が `claimed` を見ることは無い。
- そのため、runner をまだ呼んでいない `lifecycle.checkpoint` の失敗でも `uncertain` になり、同じ実行はやり直せない。
- `AutomationRunPhase` の `uncertain` と `claimed` は `release` に渡されない。`retryable` と `receipt_persisted` と `completed` も、今は渡されない。

## host の lifecycle

lifecycle port は省略できる。あるとき、コアは次の順で呼ぶ。

```text
lookup(prepared) -> designGate(prepared) -> humanGate(prepared)
-> runStore.claim
-> checkpoint(claimed)
-> runStore.markRunnerStarted -> transition(claimed -> runner_started)
-> runner -> receipt.persist
-> runStore.markReceiptPersisted -> transition(runner_started -> receipt_persisted)
-> runStore.complete -> runStore.read -> transition(receipt_persisted -> completed)
```

- `lookup`、`designGate`、`humanGate` は claim の前に呼ぶ。拒否されたときは記録を作らない。
- `replay` と、読み直して `completed` だった `in_progress` の claim では、`transition(receipt_persisted -> completed)` だけをもう一度呼ぶ。失敗すると `automation_run_uncertain` で止まる。
