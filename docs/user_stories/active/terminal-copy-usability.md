---
story_id: terminal-copy-usability
title: Improve terminal copy usability around file links and long ranges
source_requirement:
  type: user_report
  description: Brainbase の xterm 表示文字をコピーするとき、ファイルビューアのリンクを横断する選択と表示範囲を超えた広い範囲のコピーがやりづらい。
reason: 既存の terminal runtime / scrollback 境界内で、xterm file link のgesture判定と既存content APIのコピー範囲指定だけを変更するため新規ADRは不要。
architecture_docs:
  - path: docs/architecture/terminal-runtime-architecture.md
    status: referenced
  - path: docs/architecture/ADR-terminal-history-scrollback.md
    status: referenced
capability_docs:
  - path: docs/brainbase-capabilities/capabilities/terminal.transport.yml
    status: referenced
related_tasks:
  - task_source: VibePro
    task_ids: [terminal-copy-usability]
status: active
created_at: 2026-05-21
updated_at: 2026-05-21
---

# terminal-copy-usability: Improve terminal copy usability around file links and long ranges

## 背景

Brainbase の xterm 画面では、Claude Code / Codex の出力からファイルパス、エラー、コード断片をコピーする操作が頻繁に発生する。

現在はファイルビューアのリンク上でドラッグを開始または通過したときに、リンクを開く操作とテキスト選択が競合しやすい。また、表示範囲を超えた長い範囲をコピーしたい場合、xterm のドラッグ選択だけに依存するとスクロールや alternate buffer の挙動に影響されて安定しない。

## 現状

- xterm 内の file link handler が `mousedown` で既定動作と伝播を止めるため、リンク上からテキスト選択を開始しにくい。
- `mouseup` / `click` でファイルリンクを開くため、選択ドラッグの終端がリンク上にあるとファイルビューア起動と競合しやすい。
- xterm は通常の DOM テキストではなく xterm 内部の selection / canvas 表示を使うため、広範囲コピーはブラウザ標準のページ選択だけでは完結しない。
- 既存のコピー用モーダルは固定 500 行取得で、長い出力をコピーしたいときに範囲を選べない。

## 変更内容

### 誰が

- Brainbase のブラウザ UI で Claude Code / Codex のターミナル出力を参照し、ファイルパス、エラー、ログ、コード断片をコピーするユーザー。

### 何を

- ファイルリンク上の `mousedown` ではテキスト選択の開始を妨げない。
- ファイルリンクの起動は、短時間かつ短距離の左クリックで、選択テキストが存在しない場合だけ行う。
- 選択ドラッグ中またはドラッグ直後は、ファイルリンクを開かずコピー操作を優先する。
- 既存のターミナルコピー用モーダルで、取得する terminal content の行数を選べるようにする。
- モバイルのコピー操作も同じ行数選択を使う。

### なぜ

- xterm 出力のコピーは、リンクを開く操作よりも細かい範囲選択が優先される場面が多いため。
- 表示範囲を超えた長いコピーは、xterm のドラッグ選択だけで解決すると不安定になりやすく、既存の content API を使ったコピー導線で補完する方が確実なため。
- terminal transport の入出力挙動は変えず、UI layer の gesture 判定とコピー範囲指定だけで改善できるため。

## 受け入れ基準

- [ ] xterm のファイルリンク上で `mousedown` しても、テキスト選択開始を妨げない。
- [ ] ファイルリンクは、左ボタンの短いクリック、移動 4px 以下、900ms 以下、かつ選択テキストなしの場合だけ開く。
- [ ] ファイルリンク上をドラッグして選択した場合、`mouseup` / `click` でファイルビューアを開かない。
- [ ] ターミナルコピー用モーダルで 500 行、2000 行、5000 行を選択できる。
- [ ] コピー用モーダルの terminal content 取得は、選択した行数を `/api/sessions/:id/content?lines=` に渡す。
- [ ] モバイルのターミナルコピー操作も、選択された行数を content API に渡す。
- [ ] terminal transport の WebSocket 入力、Enter feedback、snapshot 表示の仕様は変更しない。
- [ ] 既存の terminal input/render stability E2E は通る。

## スコープ外

- xterm 本体の selection model の置き換え。
- tmux / alternate buffer のスクロール仕様変更。
- ファイルビューアリンクの URL 解決仕様変更。
- terminal history / scrollback 保存量の変更。
- クリップボード権限やブラウザ標準コピー UI の再設計。

## 検証

```bash
npm run test:run -- tests/unit/iframe-contextmenu-handler.test.js tests/unit/terminal-interaction-service.test.js
BRAINBASE_E2E_PORT=31014 npm run test:e2e -- tests/e2e/terminal-copy-usability.spec.js tests/e2e/story-terminal-input-render-stability.spec.js
npm run typecheck
```
