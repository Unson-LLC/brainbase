---
spec_id: meeting-source-reader-v1
story_id: story-meeting-source-full-transcript-v1
status: draft
owner_repository: brainbase
export: "@unson/brainbase-mcp/meeting-source-reader"
---

# 会議ソースの読み出し v1 仕様

## 目的

PlaudとTactiqの公式MCPから、指定した期間の会議の一覧と、各会議の全文を読み出す。全文は最後のページまで読めたときだけ `complete` として返し、読めない会議は理由・範囲・次に試す時刻とともに返す。途中までの全文、空の全文、要約を全文として扱わない。

## 境界

- 読み出しは `callTool(name, args)` を外から受け取る。MCPの接続・OAuth・資格情報・保存先・同期の状態は持たない（それらは `story-meeting-source-connection-sync-v1` と組織版のStory）。
- `callTool` はMCPの `CallToolResult`（`structuredContent` または `content[].text` のJSON、`isError`）を返すか、例外を投げる。どちらも扱う。
- Tactiqの全文の取得枠（1人1時間に異なる会議10件。同じ時間内に読み直した会議は数えない）は、呼び出し側が渡せる `TactiqTranscriptBudget` で数える。呼び出しをまたいで数えるときは、同じ budget を使い回すか、記録済みの読み取り（会議IDと時刻）を渡して作り直す。

## 契約

### 一覧 `listMeetings({ provider, callTool, since, until })`

- Plaud：`list_files` を `date_from`・`date_to`（`YYYY-MM-DD`、サーバーの時間帯）で呼ぶ。時間帯の差で端の会議が落ちないよう、日付は前後1日広げて問い合わせ、`start_at` で `[since, until]` に絞る。時間帯の無い `start_at` は `plaudUtcOffsetMinutes`（既定 +540）の時刻とみなす。返った件数がページの大きさ未満になるまで `page` を送る。
- Tactiq：`search_meetings` を `dateFrom`・`dateTo` で呼ぶ。返った件数が上限（50件）に達した期間は二つに分けて取り直す。分けられない短さ（1分）でも上限に達したら `complete: false` とする。同じ会議は1件にまとめる。
- 失敗は空の一覧にせず、`{ status: 'failed', failure }` で返す。

### 全文 `readTranscript({ provider, callTool, meetingId, budget? })`

- Plaud：`get_transcript`（`block: 'transaction'`）を `next_cursor` が無くなるまで `cursor` を渡して呼ぶ。
- Tactiq：`get_transcript` を `page` 1から `hasMore` が偽になるまで呼ぶ。読む前に budget を確かめ、枠が無ければ呼ばずに `rate_limited` と次に試す時刻を返す。
- 成功は `{ status: 'complete', segments, text, digest, pageCount, segmentCount }`。`segments` は話者・開始・終了（ミリ秒）つき。
- `text` は話者つきの行（`話者: 本文`、空白を1つに詰め、空の発話は除く）を改行でつなぎ、`brainbase-unson` の `normalizeMultilineText` と同じ正規化をかけたもの。`digest` はその `text` のSHA-256（16進）。今の `brainbase-unson` の `transcript_hash` と同じ値になる。
- 失敗は `{ status: 'unavailable', failure }`。`failure` は次を持つ。
  - `reason`：`reauth_required`（認可が要る・切れた）／`access_required`（プラン・全文の許可・AIクレジット・プレビューだけの共有）／`rate_limited`／`timeout`／`not_ready`（文字起こしの生成待ち・発話0件）／`incomplete`（ページが途中で止まった）／`provider_error`
  - `scope`：`connection`（その接続のすべての会議に効く）か `meeting`（その会議だけ）
  - `retryAt`：次に試してよい時刻（分かる場合）
  - `access`：Tactiqの `access_required` のとき、`get_access_options` の `action`・`title`・`message`・`url` と、推定した原因 `cause`（`plan`・`connection`・`ai_credits`・`preview_only`・`unknown`）
- Tactiqの `access_required` は、`get_access_options` を1回呼んで理由を取る。`preview_only` だけを `scope: 'meeting'` にし、ほかは `connection` にする。

### 要約 `readProviderSummary({ provider, callTool, meetingId })`

- Plaudは `get_note`、Tactiqは `get_meeting` の `detailedSummary`。結果は `{ status: 'ok', summary: { kind: 'provider_summary', text } | null }` で、全文の結果には混ぜない。生成待ちや空は `summary: null`、失敗は `{ status: 'unavailable', failure }`。

## テスト

`tests/meeting-source-reader.test.ts`。PlaudとTactiqの実際の応答の形を写した固定データで、次を確かめる。

- Plaudの全文の複数ページ（50発話を超える）を欠けずに読み、`digest` が `brainbase-unson` の正規化と同じ値になる（AC-01・AC-07）
- Plaudの一覧のページ送りと、日付の端の会議の扱い（AC-02）
- Tactiqの全文の複数ページと、上限50件の期間の分割（AC-03）
- Tactiqの取得枠：11件目は呼ばずに `rate_limited`、読み直しは数えない（AC-04）
- 認可切れ・`access_required`（接続／プレビュー）・時間切れ・発話0件・途中停止の分類と、失敗を空の一覧にしないこと（AC-05）
- 要約を全文に混ぜないこと（AC-06）

## 未確認

- Plaudの `list_files` の応答のページ情報の項目名（記録に成功応答が無い）。件数がページの大きさ未満になるまで送る形にして、項目名に依存しない。
- Tactiqの取得枠を超えたときのエラーの形。文言（rate limit・429・too many）で `rate_limited` と判定する。
- AC-08（実アカウントでの読み出しの記録）は、このPRの固定データのテストでは満たさない。
