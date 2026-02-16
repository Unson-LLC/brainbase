# Story: Commit Tree Panel

## User Story

**誰が**: brainbase UIを使って複数セッションを切り替えながら作業する開発者（佐藤）
**何を**: セッション切り替え時にそのセッションのコミット履歴を一目で確認したい
**なぜ**: 今どのブランチで何コミット積んでるかわからず、作業状況の把握・混乱防止のため

## Acceptance Criteria

| AC | 内容 | 検証方法 |
|----|------|---------|
| AC1 | セッション選択時にコミットツリーパネルが自動更新される | SESSION_CHANGED イベント後にパネル内容が変わることを確認 |
| AC2 | 各コミットのハッシュ・説明・タイムスタンプ・ブックマーク/ブランチが見える | コミットノードの各要素が表示されることを目視確認 |
| AC3 | 現在のワーキングコピー位置がハイライトされる | `isWorkingCopy: true` のコミットに `.current` クラスが付与される |
| AC4 | パネルの幅がリサイズ可能でリロード後も保持される | localStorage にパネル幅が保存・復元されることを確認 |
| AC5 | worktreeなしセッションでは空状態が表示される | worktree未設定セッション選択時に空状態メッセージが表示される |
| AC6 | Jujutsu / Git 両方に対応 | `repoType` フィールドで jj/git を判別し適切なコマンドを実行 |

## Priority

**P1** - セッション管理の基本機能として必須

## Dependencies

- 既存の WorktreeService（VCSコマンド実行基盤）
- 既存の EventBus（SESSION_CHANGED イベント）
- 既存の panel-resize モジュール
