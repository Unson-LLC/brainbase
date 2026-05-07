---
adr_id: ADR-005
title: ConversationLinker周期処理の負荷分散
source_story:
  story_id: STR-005
  path: docs/stories/STR-005-conversation-linker-load-shedding.md
status: accepted
created_at: 2026-05-07
updated_at: 2026-05-07
---

# ADR-005: ConversationLinker周期処理の負荷分散

## 決定

`ConversationLinker` の Codex index は、全ファイルを毎回読み直すのではなく、ファイル単位の観測結果をキャッシュし、変更が検出されたファイルだけを再評価する。

## 責務境界

| 領域 | 責務 |
|---|---|
| ConversationLinker | Codex / Claude 会話ログと brainbase session の紐付けを維持する |
| Codex file metadata cache | Codex jsonl の file path / mtime / size / cwd を保持し、未変更ファイルの再読み取りを避ける |
| StateStore | 紐付け済み conversation summary の保存を担う |
| Logger | 通常運用で必要な状態変化を出し、高頻度 heartbeat は debug に退避する |

## データ境界

Codex jsonl 本文は外部 CLI の生成物であり、brainbase の正本ではない。brainbase は index 構築に必要な `cwd` と、必要時の token usage / snippet だけを読み取る。

file metadata cache は process-local な派生情報であり、再起動時に失われても正しさを損なわない。再起動後の初回 index 構築だけは再読み取りを許容する。

## 制御方針

- 未変更ファイルは cache の cwd を使う
- `mtimeMs` または `size` が変わったファイルは再読み取りする
- 削除済みファイルの cache は次回 index 構築後に残さない
- 既存の `linkAll({ limit })` と cursor による分割処理は維持する
- 高頻度 heartbeat / broadcast は機能イベントとして処理するが、通常ログには出さない

## 却下した案

### 周期処理を止める

却下。会話紐付けが更新されず、session 一覧の文脈表示が古くなる。

### cache TTL を長くするだけにする

却下。周期処理の回数は減るが、TTL が切れた時点で再び全 jsonl 読み取りが発生する。

### Codex 履歴を別DBへ移す

却下。今回の目的に対して変更範囲が大きく、外部 CLI の履歴管理責務と混ざる。
