# VibePro Skills Usage

Brainbaseが管理する実装判断では、`.claude/skills/vibepro-workflow/SKILL.md`を入口にします。

1. 受け入れた変更を、一つのStoryと最小限のSpecへまとめる。
2. 変更するコードと影響するテストを特定する。
3. Architectureは境界の変更に応じて使う。Graphify導入済みなら改修規模によらず[軽量参照](vibepro-impact-review.md)を行い、同条件の結果は再利用する。更新・深い探索は必要な場合に限る。
4. 実装し、影響するテストを実行する。
5. 必要なら一回だけ範囲を絞ったレビューを行う。
6. リポジトリ標準のGitHub PR、CI、merge手順へ進む。

Skillの導入確認、生成物、Gate、スコア、コマンド実行記録を完了条件にはしません。VibeProは補助であり、承認、merge、deploy、組織判断の権限を持ちません。
