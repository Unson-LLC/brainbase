# Story: 委任復旧時の判断入力をMCPへ渡せる

## 利用者価値

Brainbase利用者として、新しいCodexタスクへ委任した仕事でも、Brainbaseが判断に使った入力と実際の成果を完了直後の判断レシートで確認したい。これにより、委任タスクだけ判断解決が失敗して価値表示へ到達しない状態を避けられる。

## 背景

Codex Appから作成した委任タスクは`UserPromptSubmit`を通らず、最初の`Stop`で判断episodeを復旧する。この経路ではepisode内に`turn_input`が残る一方、MCPが`turn_ref`から読む`.turn-input.json`が保存されていなかった。そのためMCPは`judgment_resolution_input_invalid`を返し、判断レシートを生成できなかった。

## 受け入れ基準

- [x] AC-001: 委任タスクを最初の`Stop`で復旧した時、episodeが参照する同一内容の`.turn-input.json`をHostが保存する。
- [x] AC-002: episodeだけが残り`.turn-input.json`が欠落した途中状態でも、次の`Stop`で判断入力を再保存できる。
- [x] AC-003: 通常の`UserPromptSubmit`経路、既存episode、MCPの`turn_ref`読取契約を変更しない。
- [x] AC-004: 修正前に失敗する回帰テストと、Host/MCP境界の既存テストで挙動を検証する。

## 対象外

- 判断レシートのSchemaやRendererの変更
- Slack、Mana、Web画面の表示Adapter
- 通常のCodexタスクをCodex Appから自動操作する機能
