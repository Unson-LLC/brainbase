---
story_id: STR-005
title: ConversationLinkerの周期処理負荷を抑える
source_requirement:
  requirement_title: "brainbase自体の重い処理をLokiで分析して解消する"
architecture_docs:
  - path: docs/architecture/ADR-005-conversation-linker-load-shedding.md
    status: created
status: in_progress
created_at: 2026-05-07
updated_at: 2026-05-07
---

# STR-005: ConversationLinkerの周期処理負荷を抑える

## 背景

brainbase の Loki ログとローカル計測で、CSRF warning 以外にも周期的な負荷源が見つかった。

`ConversationLinker` は会話ログの紐付けを自動で更新するために動いているが、Codex の過去セッションが増えるほど、定期処理のたびに不要な読み取りが膨らむ。

## 誰が

brainbase を日常的に使う開発者として。

## 何を

会話ログの紐付け機能を維持したまま、変更のない Codex セッションログを周期処理のたびに読み直さない状態にしたい。

## なぜ

バックグラウンド処理が重いと、UI 操作、セッション切替、terminal 操作の体感が悪くなる。利用者が直接要求していない周期処理は、必要な差分だけを扱い、普段の作業を邪魔しない必要がある。

## 受け入れ基準

- [ ] 変更されていない Codex jsonl は、次回以降の index 再構築で cwd 読み取りを再実行しない
- [ ] Codex jsonl が更新された場合は、更新後の cwd を index に反映する
- [ ] 会話紐付けの既存動作は維持される
- [ ] heartbeat / Activity WebSocket の通常ログ量を削減し、必要時は debug で追える
- [ ] VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる

## スコープ外

- Loki / Promtail / Grafana の構成変更
- Codex / Claude の履歴ファイル形式の変更
- 会話ログの永続化スキーマ変更

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・誰が・何を・なぜ・受け入れ基準のみ。
