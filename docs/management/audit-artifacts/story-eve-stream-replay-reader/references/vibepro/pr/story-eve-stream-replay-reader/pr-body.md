## 判断
- このPRで判断すること: Eve session streamのlive-tail増分読取（replay完了で打ち切り） を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-eve-stream-replay-reader - Eve session streamのlive-tail増分読取（replay完了で打ち切り）
- 正本: [docs/stories/story-eve-stream-replay-reader.md](docs/stories/story-eve-stream-replay-reader.md)
- 変更範囲: 4 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/stories/story-eve-stream-replay-reader.md](docs/stories/story-eve-stream-replay-reader.md)
- 実装: server/services/external-runner/eve-session-client.js
- テスト: [tests/e2e/story-eve-stream-replay-reader-contract.spec.ts](tests/e2e/story-eve-stream-replay-reader-contract.spec.ts), [tests/server/services/eve-session-client.test.js](tests/server/services/eve-session-client.test.js)

## 経緯
- 要求: Eve session streamのlive-tail増分読取（replay完了で打ち切り）
- 発生経緯: story-eve-meeting-note-pull-reconciler（PR #1033）のデプロイ後、実運用初tickで対象6 runすべてが `Eve session stream timed out after 30000ms` になった。原因を実測で特定: eveのsession stream route（`GET /eve/v1/session/:id/stream`）は**live tail設計**で、durableなイベント履歴を即座にreplayした後もHTTP接続を閉じない（クライアントは `startIndex` で再開する前提）。`EveSessionClient.readSessionStream()` は `response.text()` で接続closeを待つため、parkedセッションでは永遠に完了せずタイムアウトし、既に受信済みの全replayデータが破棄されていた（curl実測: HTTP 200・全123KB受信済みのまま接続が開き続ける）。 このstoryでは `readSessionStream()` を増分読取に変更する: 1. `response.body.getReader()` でchunkを逐次読み、NDJSONの**完全行**のみをパースする。 2. 最新の完全行が境界イベント（`session.waiting` / `session.completed` /...


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/stories/story-eve-stream-replay-reader.md](docs/stories/story-eve-stream-replay-reader.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 3 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- 主要ソース差分: server/services/external-runner/eve-session-client.js
- ...and 1 more
- Risk: 最新診断gateが needs_review

## 確認
- [ ] 手動確認または対象テストを追記する
- 最終E2E: pass: Playwright contract spec drives EveSessionClient end-to-end with live-tail ReadableStream fixtures; 12/12 pass at current head. Confirms the running session reads the expected artifact version of the reader (boundary cutoff, idle cutoff, closed-stream parse, unchanged auth/error contract).（var/story-evidence/playwright-eve-stream-reader.json）

## 詳細
- 証跡: [.vibepro/pr/story-eve-stream-replay-reader/](.vibepro/pr/story-eve-stream-replay-reader/)
- PR準備: [.vibepro/pr/story-eve-stream-replay-reader/pr-prepare.json](.vibepro/pr/story-eve-stream-replay-reader/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-eve-stream-replay-reader/decision-index.json](.vibepro/pr/story-eve-stream-replay-reader/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 670f7b40a64a detached/package dirty (story=story-eve-stream-replay-reader)
