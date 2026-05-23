# SNS mobile review terminal guard

## Story

モバイルで Brainbase 内の SNS Growth を開いて投稿レビューカードをタップしたとき、Terminal live view が開かず、選択した投稿の詳細をそのまま読める。

## Problem

SNS Growth は `console-area` 内の workspace overlay として表示される。モバイルの terminal snapshot mode では `console-area` クリックが live terminal を開く導線になっているため、overlay 上のレビュー操作が terminal surface 操作として扱われる余地があった。

## Acceptance

- SNS Growth overlay 表示中は terminal surface を可視扱いしない。
- モバイルでレビューカードをタップしても `openMobileLiveTerminal` が呼ばれない。
- 投稿詳細ペインが表示され、Terminal stage は非表示のまま残る。

## Non-goals

- 既存の session switch token guard、current session guard、stale session guard の挙動は変更しない。
- Terminal runtime の接続・再接続・session 切替契約はこのStoryの対象外とし、既存テストで守る。
