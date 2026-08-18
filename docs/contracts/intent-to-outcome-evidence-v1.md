# intent_to_outcome_evidence.v1 契約

## 目的

AI活用を、トークン量やツール利用回数ではなく「利用者の意思が、少ない認知負荷で、検証可能な現実の成果になったか」で評価する。

本契約は`docs/decisions/2026-08-18_intent-to-outcome-north-star.md`の計測境界である。Run Receipt、タスク台帳、Graph、Git、外部サービスの読み戻しなど、既存の実行証跡へ適用する。

## 評価単位

一つの`intent_id`に対し、次の状態を区別する。

- `captured`: 意思と完了条件を取得した。
- `executing`: AIが文脈取得または実行を進めている。
- `waiting_human`: 目的、価値判断、責任、権限、または安全に推論できない情報を待っている。
- `outcome_verified`: 完了条件を現実の正本または実データで読み戻した。
- `blocked`: 依存先、権限、データ、または実行経路の問題で停止した。
- `unconfirmed`: 実行したが、現実の結果を確認できていない。

`success`、HTTP 200、テスト成功、デプロイ成功、ファイル保存のいずれも、それ単独では`outcome_verified`を意味しない。

## 必須指標

| 指標 | 定義 | 良い方向 |
|---|---|---|
| `verified_outcome` | 完了条件を正本または実データで読み戻せたか | `true` |
| `repeated_explanation_count` | 利用者が既に与えた目的・前提・用語を再説明した回数 | 少ない |
| `avoidable_user_interruption_count` | AIが取得・推論・検証できたのに利用者へ確認を返した回数 | 少ない |
| `necessary_human_decision_count` | 目的・価値判断・責任・権限のため人間判断を求めた回数 | 事実として記録 |
| `rework_count` | 誤解、未検証の完了報告、正本の取り違えによりやり直した回数 | 少ない |
| `prior_learning_reused` | 過去の判断・知識・証跡を再利用し、再説明や再調査を省けたか | `true` |
| `token_usage` | 入出力・推論・ツール利用の計測可能な消費量 | 成果との比で解釈 |

トークンは制約および費用指標であり、単独の目的指標にしない。トークン増加が検証済み成果、再利用可能な学習、将来の認知負荷削減につながる場合は、直ちに無駄と判定しない。

## 証跡規則

- 各指標に`evidence_ref`を付ける。参照先がない値は`unconfirmed`とする。
- 取得不能、未計測、対象なしをすべて`0`へ丸めない。それぞれ`unavailable`、`unconfirmed`、`not_applicable`として残す。
- 利用者の認知状態をログから断定しない。明示的な再説明・差し戻し、または利用者自身の評価だけを事実として数える。
- ファイル作成は成果物の証跡、API応答は受理の証跡、テストは実装契約の証跡として扱い、現実の成果証跡と分ける。
- 複数実行を比較するときは、同じ開始条件、完了条件、計測方法を用いる。比較不能なら改善量を`unknown`とする。

## 最小記録例

```json
{
  "contract_version": "intent_to_outcome_evidence.v1",
  "intent_id": "intent_example",
  "state": "outcome_verified",
  "metrics": {
    "verified_outcome": true,
    "repeated_explanation_count": 0,
    "avoidable_user_interruption_count": 0,
    "necessary_human_decision_count": 1,
    "rework_count": 0,
    "prior_learning_reused": true,
    "token_usage": null
  },
  "evidence_refs": [
    { "kind": "canonical_readback", "ref": "brainbase://example" }
  ]
}
```
