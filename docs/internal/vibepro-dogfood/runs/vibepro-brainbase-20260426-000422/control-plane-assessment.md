# VibePro Control Plane Assessment: vibepro-brainbase-20260426-000422

## 判定

サービス仮説は一段強くなった。

ただし、まだ有償サービス Go ではない。

## 今回の検証範囲

repo / dogfood run / MCP / Claude hooks / GitHub Actions / Graph SSOT projection / Story-to-Ship / coverage を横断して観測した。

観測factは10件。

| fact_id | 種別 | 重要度 |
|---|---|---|
| `fact.repo.detached_head` | change_control | medium |
| `fact.repo.unrelated_dirty_files` | change_control | medium |
| `fact.vibepro.scorer_manual_only` | automation | medium |
| `fact.vibepro.incomplete_run_outputs` | evaluation_unavailable | medium |
| `fact.mcp.secret_values_in_repo_config` | secret_management | high |
| `fact.hooks.missing_referenced_scripts` | agent_recovery_blocker | high |
| `fact.workflows.vibepro_score_not_automated` | automation | medium |
| `fact.graph.ssot_not_automatically_verified` | ssot_integrity | medium |
| `fact.story_to_ship.vibepro_dogfood_unshipped` | story_to_ship_gap | medium |
| `fact.ci.vibepro_scorer_outside_coverage_scope` | ci_evaluation_gap | medium |

## 指標

| 指標 | 値 |
|---|---:|
| 本番化ギャップ捕捉率 | 1 |
| 本番化ギャップ的中率 | 1 |
| ゲート違反流出率 | 0 |

## 冷酷な評価

今回は、前回より明確に「サービス化に近い検証」になった。

理由は、検出したギャップが単なるrepo状態ではなく、AI-first運用の本番化を壊す種類に広がったため。

特に価値があるのは次の3つ。

1. `fact.mcp.secret_values_in_repo_config`
   - AI agentのtooling設定が漏洩リスクを持つ。これは顧客環境でも起きやすく、実害に近い。
2. `fact.hooks.missing_referenced_scripts`
   - guardrailが設定上は存在するように見えて、実際には欠けている。AI自走の安全性を直接壊す。
3. `fact.graph.ssot_not_automatically_verified`
   - AI-first会社OSではSSOTズレが判断品質を壊す。Graph正本とdocs投影の自動照合がないのはcontrol plane対象として妥当。

一方で、まだ弱い点もある。

- 診断は観測factをすべて拾ったが、隠れた因果や優先順位最適化まではできていない
- 10件のうち多くは静的構成チェックで、実行ログや顧客フローの失敗までは見ていない
- 介入後の改善効果をまだ測っていない
- `1 / 1 / 0` は広域観測の成立確認であって、診断モデルの汎化性能ではない

## サービス化に向けた次の合格条件

次は検出だけではなく、介入価値を測る。

最低条件:

1. high severity の2件を修正する
   - MCP secret値のrepo直書き
   - missing hook script参照
2. 修正後に再runする
3. 次の改善が数値で出ることを確認する
   - `secret_management` fact が0になる
   - `agent_recovery_blocker` fact が0になる
   - 本番化ギャップ件数が10件から減る
   - ゲート違反流出率が0のまま維持される

この改善効果まで出せれば、VibeProは「診断レポート」ではなく「AI-first運用の改善control plane」として説明できる。
