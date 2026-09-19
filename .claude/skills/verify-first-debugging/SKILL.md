---
name: verify-first-debugging
description: 不具合の調査・修正、失敗テストや間欠障害の原因確認を行うときに使う。
---

# VERIFY-FIRST デバッグ

不具合の報告、失敗したテスト、間欠的な障害、修正の根因レビューに使う。目的は、推測を確認済みの事実から分け、元の症状を検証できる修正へつなぐこと。固定のPhase数、エージェント数、モデル、再試行回数は要求しない。

## 入力

- 期待する動作と観測した症状
- 再現率、発生条件、環境、ログ、テスト結果（不明なものは不明のまま）
- 影響しそうなファイル、関数、設定、データ、変更履歴

## 最小ループ

1. 期待値と観測値を一文ずつ書く。再現率が100%でなくても、頻度・条件・未確認範囲を記録する。
2. 直接の証拠（テスト、ログ、readback、コード、差分）から影響経路を絞る。履歴確認は原因や回帰に関係するときだけ行う。
3. 症状に合う確認観点を一つ以上選び、関係する入力・変換・境界・前提条件を照合する。全種類の確認を一律には実行しない。
4. 確認済み事実、推測、未知を分けて、最小の根因を説明する。Whyの連鎖は役立つ場合だけ使う。
5. 根因の境界を修正し、元の症状、関連する不変条件、必要なテストを再確認する。成功していない確認や部分的な結果を成功扱いしない。

## 症状からのルーティング

必要な資料だけを選ぶ。詳細な旧手順は `agents/` に残っているが、選んだ観点の資料だけ読む。旧資料から固有の診断観点だけを参照し、固定工程・人数・モデル・再試行回数・完全再現の要求をこの入口へ持ち込まない。

| 症状・変更 | 参照先 |
| --- | --- |
| UI、レイアウト、CSS、表示 | [診断ファミリー](references/diagnostic-families.md#ui) / [旧資料](agents/phase3a_ui_consistency.md) |
| `undefined`、null、scope、非同期 | [診断ファミリー](references/diagnostic-families.md#runtime) / [旧資料](agents/phase3b_variable_lifecycle.md) |
| API、変換、enum、filter、計算 | [診断ファミリー](references/diagnostic-families.md#logicdata) / [旧資料](agents/phase3c_data_flow.md) |
| 保存場所、状態、インフラ境界 | [診断ファミリー](references/diagnostic-families.md#architecture) / [旧資料](agents/phase3d_data_architecture.md) |
| リファクタリング後のテスト失敗 | [診断ファミリー](references/diagnostic-families.md#refactoring) / [旧資料](agents/phase3e_code_test_sync.md) |
| 設定、環境変数、デプロイ、セキュリティ | [診断ファミリー](references/diagnostic-families.md) |
| 種別が不明 | まず直接の証拠を取り、証拠が示す観点を一つずつ選ぶ |

## 出力

```markdown
expected: 期待動作
observed: 観測した症状と発生率
evidence: 確認済みの事実と参照先
hypotheses: 未確認の推測（あれば）
root_cause: 事実で説明できる根因
change: 根因に対して行った変更
verification: 元の症状と関連する不変条件の確認
unknowns: 未確認・部分的・環境依存の範囲
```

## 境界

- 間欠障害に完全再現を要求しない。条件を変えずに盲目的な再試行を続けず、新しい証拠や変化がある場合だけ再確認する。
- 失敗した調査を無視しない。タイムアウト、未接続、認証失敗、部分的な結果はそのまま記録する。
- 外部作用、破壊的操作、機密情報、既存のdirty変更は、通常の権限・承認・保護境界に従う。

## 参照

- [診断の原則](references/diagnostic-principles.md)
- [診断ファミリー](references/diagnostic-families.md)
