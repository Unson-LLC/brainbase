# VibePro Control Plane Assessment: vibepro-brainbase-20260425-234956

## 判定

探索継続に値する。

ただし、サービス化 Go ではない。

## 今回の検証で前進した点

今回のrunでは、VibeProを単なる診断レポート生成ではなく、AI-first運用の本番化阻害を検出するcontrol planeとして扱った。

機械観測で出た実ギャップは3件。

| fact_id | 種別 | VibePro診断 |
|---|---|---|
| `fact.repo.unrelated_dirty_files` | change_control | 別意図の未コミット変更混在 |
| `fact.vibepro.scorer_manual_only` | automation | 採点CLIがworkflow未接続 |
| `fact.vibepro.incomplete_run_outputs` | evaluation_unavailable | 過去runの必須成果物欠落 |

3件とも、AI-first運用の本番化を壊す方向のギャップだった。

## 指標

| 指標 | 値 |
|---|---:|
| 本番化ギャップ捕捉率 | 1 |
| 本番化ギャップ的中率 | 1 |
| ゲート違反流出率 | 0 |

## 冷酷な評価

今回の検証は、前回よりサービス仮説に近い。

理由は、検出対象が「git状態の浅い指摘」から、「AI-first運用が継続評価不能になる原因」に近づいたため。

特に `fact.vibepro.incomplete_run_outputs` は重要。これは単なる不備ではなく、VibePro自身の改善ループが壊れる兆候である。こういうギャップを自動検出できるなら、control planeとしての価値がある。

一方で、まだ弱い。

- 観測対象が repo / skill / dogfood run に限定されている
- Graph SSOT、MCP、agentログ、CI、Story-to-Ship、実ユーザーフローはまだ見ていない
- 診断は観測factを正しく分類した段階で、隠れた因果を発見したわけではない
- 指標は3件中3件一致であり、統計的な実力値ではない

## サービス仮説として残った芯

VibeProのサービス価値は、AI導入コンサルのレポートではない。

価値が出る可能性があるのは、次の状態を継続的に検出し、直す順番と改善効果まで追える場合。

- AI自走阻害
- 評価不能
- SSOT崩壊
- 人間ゲート漏れ
- 変更混入
- agent復旧不能
- 本番化前の運用事故予兆

## 次の合格条件

次の検証では、観測factを10件前後に増やし、そのうち少なくとも次を含める。

1. Graph SSOTとdocs投影のズレ
2. Story / Architecture / Spec / Code のリンク切れ
3. invalid SKILL.md
4. MCP起動失敗または設定不整合
5. CI/test失敗
6. agentログ上の繰り返し失敗
7. 未commit/未push/別意図混入
8. 人間ゲートが必要な変更の自動化リスク

この条件で捕捉率・的中率が維持できれば、サービス仮説は一段強くなる。
