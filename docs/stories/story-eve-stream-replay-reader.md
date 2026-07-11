---
story_id: story-eve-stream-replay-reader
title: Eve session streamのlive-tail増分読取（replay完了で打ち切り）
status: active
created_at: 2026-07-12
updated_at: 2026-07-12
---

# Eve session streamのlive-tail増分読取（replay完了で打ち切り）

## Story

story-eve-meeting-note-pull-reconciler（PR #1033）のデプロイ後、実運用初tickで対象6 runすべてが `Eve session stream timed out after 30000ms` になった。原因を実測で特定: eveのsession stream route（`GET /eve/v1/session/:id/stream`）は**live tail設計**で、durableなイベント履歴を即座にreplayした後もHTTP接続を閉じない（クライアントは `startIndex` で再開する前提）。`EveSessionClient.readSessionStream()` は `response.text()` で接続closeを待つため、parkedセッションでは永遠に完了せずタイムアウトし、既に受信済みの全replayデータが破棄されていた（curl実測: HTTP 200・全123KB受信済みのまま接続が開き続ける）。

このstoryでは `readSessionStream()` を増分読取に変更する:

1. `response.body.getReader()` でchunkを逐次読み、NDJSONの**完全行**のみをパースする。
2. 最新の完全行が境界イベント（`session.waiting` / `session.completed` / `session.failed`）になった時点でreplay完了とみなし、接続を放棄してイベント列を返す。
3. 境界イベント未到達（mid-turnセッション）は `idleMs`（デフォルト3秒）の無受信で打ち切り、受信済み完全行を返す（reconcilerはin_progress判定→次tick再確認）。
4. 接続がcloseした場合は従来どおり全文をパースする（末尾改行なし行も保持、既存テスト互換）。
5. 呼び出し側の契約（返り値: パース済みイベント配列、エラー型）は不変。

## Invariants

- INV-reader-001: 返り値の契約は不変（パース済みイベント配列）。呼び出し側（reconciler）の変更は不要。
- INV-reader-002: 境界イベント打ち切りとidle打ち切りでは完全行のみを返す（途中で切れた行を壊れたイベントとして返さない）。接続closeでは全文（末尾改行なし行含む）をパースする。
- INV-reader-003: 非streaming fetch実装（テストダブル等、`response.body.getReader` 不在）では従来の `text()` パスにフォールバックする。
- INV-reader-004: 全体タイムアウト（`EVE_API_TIMEOUT_MS`）と呼び出し側signalの中断semanticsは維持する。放棄したtail接続は `reader.cancel()` で解放する。

## Acceptance Criteria

- [ ] AC-001: parked済みセッション（境界イベントがreplay末尾にある）のstream読取が、接続closeを待たずにreplay全イベントを返す。
- [ ] AC-002: mid-turnセッション（境界イベントなし）はidleMs経過で受信済み完全行を返す。
- [ ] AC-003: 放棄したlive tailの末尾不完全行は破棄され、接続closeしたstreamでは末尾改行なし行も保持される。
- [ ] AC-004: 境界イベント検出後にtailが追加チャンクを流しても、境界時点までのイベントで打ち切られる。
- [ ] AC-005: 既存のreadSessionStream契約テスト（認証ヘッダ・非2xxエラー・NDJSONパース）が変更なしで通過する。

## Scenario IDs

- S-001: The reconciler's real first tick completes against live Eve sessions instead of timing out, and the staged note is extracted.
- S-002: Mid-turn and abandoned-tail reads return only complete lines; closed streams keep the final unterminated line.

## Architecture Decision

ADR-unnecessary: クライアント内部の読取方式変更のみで、公開契約・依存・永続状態は不変。代替案（eve側にreplay-onlyオプション追加）はeve packageの改変が必要で管轄外のため却下。ロールバックはgit revertで安全（読取方式が戻るだけ）。

## Verification

- Unit: `tests/server/services/eve-session-client.test.js`（live-tail 4ケース追加、既存13ケース不変）
- Regression: `tests/server/services/eve-meeting-note-reconciler.test.js`, `tests/server/routes/workflows.test.js`, `tests/server/services/workflow-org-agent-control.test.js`
- Real-world: `readSessionStream({sessionId: 'wrun_01KX82TDZTW4X1A2RVCA51RCRE'})` が1.4秒で276イベント（last=session.waiting）を返し、note tool-callを抽出できることを実Eve APIで確認
