---
name: dev-workflow-guide
description: 開発変更の目的に応じて、対象Skill・コマンド・検証範囲を選ぶときに使う。
---

# 開発ワークフローのルーター

このSkillは詳細手順を再掲せず、依頼の到達点に必要な入口だけを選ぶ。作業の前に対象repo、変更の目的、既存のStory/Spec、現在のdirty状態を確認する。

## 使用するとき

- 開発変更の進め方、参照先、検証範囲が曖昧なとき
- 複数のSkillに見える依頼から、今回必要な一つまたは少数の入口を選ぶとき
- 既存の開発手順が現在のrepoの権限・レビュー・配布境界と整合するか確認するとき

## 入力

- ユーザーが求める到達点と受け入れ条件
- 対象repo、branch、HEAD、upstream、dirty変更
- 変更対象の境界（コード、文書、設定、CI、runtime、production）
- Judgment、AGENTS.md、CLAUDE.md、既存Story/Specが示す適用ルール

## 目的別の入口

| 目的 | 最初に読むSkill | 適用条件 |
| --- | --- | --- |
| 実装をStoryからPRまで進める | [vibepro-workflow](../vibepro-workflow/SKILL.md) | Judgmentの`classification.intent=implement`、またはrepoがVibeProを使う変更 |
| Story/Specの作成・受け入れ条件の整理 | [vibepro-workflow](../vibepro-workflow/SKILL.md) | 一つの利用者価値と検証可能な不変条件を定義するとき |
| branch、worktree、dirty変更を扱う | [git-workflow](../git-workflow/SKILL.md)、[branch-worktree-rules](../branch-worktree-rules/SKILL.md) | 作業場所を作る、分離する、またはGit状態を確認するとき |
| commitの形式・粒度を決める | [git-commit-rules](../git-commit-rules/SKILL.md)、[git-workflow](../git-workflow/SKILL.md) | commit、PR、merge、反映確認を行うとき |
| 変更に必要なテスト層を選ぶ | [test-strategy](../test-strategy/SKILL.md) | 変更した振る舞いと不変条件から検証を選ぶとき |
| TDDを明示的に採用する | [tdd-workflow](../tdd-workflow/SKILL.md) | ユーザーまたはrepoのルールがTDDを求めるときだけ |
| ワークフロー自体を監査する | [test-workflow-validator](../test-workflow-validator/SKILL.md) | プロジェクトの運用整合性を検証する依頼のときだけ |
| 不具合の原因と修正をつなぐ | [verify-first-debugging](../verify-first-debugging/SKILL.md) | 症状、証拠、根因、修正後の確認が必要なとき |
| アーキテクチャ境界を確認する | [architecture-patterns](../architecture-patterns/SKILL.md) | EventBus、Store、DI、Service境界の変更が関係するとき |
| セキュリティ影響を確認する | [security-patterns](../security-patterns/SKILL.md) | XSS、CSRF、入力検証などの境界が関係するとき |
| GitHub Actionsを変更する | [github-actions-management](../github-actions-management/SKILL.md) | workflow、scheduled job、CI文書を作成・変更するとき |
| Claude CodeのHooksを扱う | [claude-code-hooks-gotchas](../claude-code-hooks-gotchas/SKILL.md) | 設定形式、発火条件、失敗の調査が必要なとき |
| CI/CDの認証を扱う | [claude-code-cicd-auth](../claude-code-cicd-auth/SKILL.md) | 自動化環境の認証設定を変更するとき |
| デプロイ・稼働環境を扱う | [deployment-platforms](../deployment-platforms/SKILL.md) | 対象platform、更新、health、readbackを確認するとき |
| UIのデザイン資料やCursor手順を読む | [ui-design-resources](../ui-design-resources/SKILL.md)、[cursor-design-to-code](../cursor-design-to-code/SKILL.md) | デザイン資料が必要、またはCursorを明示されたとき |
| 開発serverを起動・停止する | [worktree-dev-server](../worktree-dev-server/SKILL.md) | 対象テストだけで証明できず、隔離runtimeが必要なとき |

## 必要な判断と進め方

- `AGENTS.md` と対象Skillを必要な範囲だけ読み、repoの現在状態と完了条件を記録する。`CLAUDE.md` は同一内容のため重ねて読む必要はない。
- 上表から症状・変更境界に合う入口を選ぶ。詳細資料はその入口から必要なときだけ読む（段階的開示）。
- VibeProが適用される実装は、一つのStoryと最小のSpecを先に確定する。Architecture/ADRは境界が変わる場合だけ扱う。
- 既存の所有者・dirty変更・認証・保存場所を保ったまま、受け入れ条件を満たす最小の変更を行う。
- 変更に直接関係するテストを実行し、失敗、未接続、認証失敗、partialを成功へ変換しない。全体テストはCIの責務とrepoの指示に従う。
- VibeProの変更は標準のreview waveと通常のGitHub PR経路へ渡す。CI、merge、deploy、稼働readbackはそれぞれ別の完了事実として扱う。

## 出力と完了条件

- 選んだ入口、変更ファイル、受け入れ条件、実行した検証を利用者へ返す。
- テスト結果、CI/PR/稼働readbackの確認範囲を分け、未確認・部分的・環境依存の範囲を残す。
- Git操作を行った場合はbranch、HEAD、upstream、dirty状態を確認する。別作業の変更を成果に混ぜない。
- 外部作用やproduction変更を行った場合は、承認・実行結果・対象環境・readbackを別々に示す。readbackがなければ完了としない。

## 境界

- 固定のPhase数、エージェント数、モデル、再試行回数をこのルーターから要求しない。全Skillの一括実行やrepo全体の事前読了も要求しない。
- secrets、外部送信、公開、削除、production書込み、deploy、mergeは通常の権限と承認に従う。VibeProやreceiptは権限を付与しない。
- 既存のdirty変更を上書き・stash・resetせず、`git add -A`や無関係な広域変更を避ける。commit、PR、mergeは[Git操作](../git-workflow/SKILL.md)の境界に従う。
- `vibepro execute start`、managed-worktree実行、Gate DAG、review authorize/start/close/repairなど退役済み契約を新しい必須工程に戻さない。

## 関連資料

- [リポジトリの開発入口](../../../AGENTS.md)
- [VibeProの影響確認runbook](../../../docs/brainbase-capabilities/runbooks/vibepro-impact-review.md)
- [開発serverの扱い](../worktree-dev-server/SKILL.md)
