# ExecPlan: セッションUX待機時間短縮（brainbase）

## 1. 目的
- セッション切替、セッション起動、モバイル初期表示、再起動後復元の待機時間を削減する。
- UX指標は「ユーザーの待機時間（体感Readyまで）」。

## 2. 成果指標（KPI）
- `sessionSwitch` の `p50/p95`
- `sessionRestore` の `p50/p95`
- `mobileLoad` の `p50/p95`
- サーバー側 `start/restore/state` の `timing.totalMs`

## 3. 実装方針
1. 計測基盤を先に入れて可視化する（traceId + PERFイベント + 集計API）
2. セッション切替パスの待機削減（不要I/O削減・描画先行）
3. 状態同期ポーリングの無駄削減（軽量同期 + 差分更新）
4. 回帰テストで固定化

## 4. 実装済み（完了）
- PERFイベント追加（switch/restore/mobile start/ready）
- `X-BB-Trace-Id` 自動付与（http client）
- `/api/sessions/start` と `/api/sessions/:id/restore` の timing/traceId 返却
- `/api/state` の timing/遅延warnログ追加
- セッション切替時の全量再取得依存を削減し、軽量同期へ分離
- `loadSessionData` を並列化
- `loadSessions` に fingerprint 差分スキップを追加
- `performance-metrics` 追加（P50/P95集計、`window.brainbasePerf` 公開）
- **今回追加**:
  - `switchSession` の高速パス（`ttydRunning` 時に proxy を先に描画し、`start` を非同期で整合）
  - `/api/sessions/status` 差分判定を拡張（`running/proxyPath/port` と削除差分を検知）
  - `syncRuntimeStatus` で `proxyPath/port` を保持
  - `/api/state` の ETag/If-None-Match 対応（304返却 + conditional GET）

## 5. テスト
- `tests/domain/session/session-service.test.js`
- `tests/unit/performance-metrics.test.js`
- `tests/unit/session-indicators.test.js`（新規）
- `tests/unit/state-controller-etag.test.js`（新規）
- `tests/core/http-client.test.js`
- `tests/ui/integration/app-task-start-flow.test.js`

## 6. 残タスク
- 実機計測（desktop/mobile）で `window.brainbasePerf.getSummary()` を採取
- 採取結果の前後比較で目標値を決定（例: switch p50 1s未満）
- 必要なら `/api/state` のETag/条件付き取得を追加検討
