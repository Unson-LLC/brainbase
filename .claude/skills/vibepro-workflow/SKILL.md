---
name: vibepro-workflow
description: Use only when a target repository explicitly uses VibePro's current lightweight Story-to-Spec helpers. VibePro itself uses its normal plain-git workflow.
---

# VibePro Workflow

## Purpose

一つの合意済み変更を、Story、最小のSpec、実装、影響範囲のテスト、通常のGitHub PRへ短くつなぐ。VibeProはワークフローエンジン、マージ権限、安全判断エンジン、証跡収集ゲームではない。

## When to Use

対象リポジトリが現在の軽量なVibePro Story／Spec運用を明示している場合だけ使う。対象の `AGENTS.md` と通常のGit運用を優先し、VibePro本体には通常のbranch → test → GitHub PR → review → mergeを使う。

## Process

1. 合意済みのStoryと受け入れ条件を確認する。
2. 振る舞いと不変条件を検証できる最小のSpecを書く。
3. 境界、所有、データ契約、セキュリティ、配備、ロールバックが変わる場合だけArchitecture／ADRを更新する。
4. 実装し、変更の影響範囲に対応するテストだけを実行する。
5. 必要な場合に限り一度だけレビューし、通常のGitHub PR、CI、mergeへ進む。
6. 非阻害の指摘は現在の変更を膨らませず、後続StoryまたはIssueへ移す。

## Red Flags

次を必須条件として要求・再生成しない。

- Gate DAG、readiness Gate、delivery budget
- `gate:agent_review` と強制的な並列レビュー
- head-bound evidence staleness、レビューライフサイクル記録
- 証跡を埋めるためだけの追加作業
- `vibepro pr create`、`vibepro execute merge` の強制
- 未解決Gateを理由とした通常PRの停止

## Common Rationalizations

「旧CLIに不足が表示されたから埋める」は理由にならない。旧成果物は参考情報として扱い、新しい作業や停止条件にしない。

## Verification

受け入れ条件を変更コードと影響範囲のテストで確認する。未確認、部分成功、外部結果は成功に丸めない。検証は主張に必要な最小限にとどめる。
