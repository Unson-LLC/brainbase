---
name: vibepro-human-review
description: Use when reviewing a change in a repository that explicitly uses VibePro's current lightweight Story and Spec artifacts.
---

# VibePro Human Review

## Purpose

レビューを、証跡集めではなく「合意済みの価値と安全性を満たしているか」の一度の判断に戻す。

## When to Use

対象リポジトリが現在の軽量なVibePro Story／Spec運用を明示し、その変更をレビューする場合だけ使う。

## Process

1. Story、Spec、差分、影響範囲のテストがつながっているか確認する。
2. 受け入れ条件の未達、セキュリティまたはテナント境界、データ損失、変更した配備／ロールバック、CI検証不能だけを阻害理由にする。
3. 修正後は該当差分だけを再確認し、同じレビューの続きとして扱う。
4. 有用だが非阻害の指摘は後続StoryまたはIssueへ移す。
5. 対象リポジトリの通常のGitHub PRと権限境界へ判断を返す。

## Red Flags

- `gate:agent_review` を満たすためだけのレビュー派遣
- 並列エージェント数や終了記録を合格条件にすること
- Gate、waiver、review lifecycle、provenanceを埋めるためだけの証跡収集
- `vibepro pr create` または `vibepro execute merge` の強制
- 旧readiness出力を新しい作業やPR停止条件へ変換すること

## Common Rationalizations

「旧Gateが未解決だから追加レビューが必要」は理由にならない。レビュー失敗、タイムアウト、空出力を製品不具合へ変換せず、無限再試行しない。

## Verification

受け入れ条件に対する `approve` または具体的な阻害理由を示す。未確認は未確認のまま残し、証跡量をレビュー品質の代理指標にしない。
