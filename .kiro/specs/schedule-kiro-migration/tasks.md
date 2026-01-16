# 実装タスク: schedule-kiro-migration

## タスク一覧

### TASK-1: KiroScheduleParser作成
**要件**: REQ-1, REQ-3
**優先度**: High
**依存**: なし

- [ ] `lib/kiro-schedule-parser.js` 新規作成
- [ ] イベントパース処理実装（チェックボックス + メタデータ）
- [ ] `serializeEvent()` 実装
- [ ] `getSchedule(date)` 実装
- [ ] `addEvent(date, event)` 実装（重複チェック付き）
- [ ] `updateEvent(date, eventId, updates)` 実装
- [ ] `deleteEvent(date, eventId)` 実装
- [ ] ユニットテスト作成（カバレッジ80%以上）

**成果物**:
- `lib/kiro-schedule-parser.js`
- `tests/kiro-schedule-parser.test.js`

---

### TASK-2: ScheduleParserデュアルモード対応
**要件**: REQ-3
**優先度**: High
**依存**: TASK-1

- [ ] `useKiroFormat` オプション追加
- [ ] コンストラクタでKiroScheduleParser初期化
- [ ] `getTodaySchedule()` の分岐処理
- [ ] 後方互換テスト（旧形式読み取り確認）
- [ ] 統合テスト追加

**成果物**:
- `lib/schedule-parser.js`（修正）
- `tests/schedule-parser.test.js`（追加）

---

### TASK-3: マイグレーションスクリプト作成
**要件**: REQ-5
**優先度**: High
**依存**: TASK-1

- [ ] `scripts/migrate-schedules-to-kiro.js` 新規作成
- [ ] YYYY-MM.md の日付セクション抽出
- [ ] YYYY-MM-DD/schedule.md への変換
- [ ] バックアップ機能（_schedules-backup/）
- [ ] ドライランモード（--dry-run）
- [ ] package.json に `npm run migrate:schedules` 追加
- [ ] 実行テスト（既存データで確認）

**成果物**:
- `scripts/migrate-schedules-to-kiro.js`
- `_schedules-backup/`（実行後）

---

### TASK-4: サーバー統合
**要件**: REQ-3, REQ-4
**優先度**: Medium
**依存**: TASK-2

- [ ] `server.js` でScheduleParser初期化更新
- [ ] 環境変数 `KIRO_SCHEDULE_FORMAT` 対応
- [ ] 起動時ログ出力（フォーマット種別）

**成果物**:
- `server.js`（修正）
- `.env.example`（追加）

---

### TASK-5: APIエンドポイント追加
**要件**: REQ-4
**優先度**: Medium
**依存**: TASK-4

- [ ] `GET /api/schedules/today` 実装
- [ ] `GET /api/schedules/:date` 実装
- [ ] `POST /api/schedules/:date/events` 実装
- [ ] `PUT /api/schedules/:date/events/:id` 実装
- [ ] `DELETE /api/schedules/:date/events/:id` 実装
- [ ] APIテスト作成

**成果物**:
- `server/routes/schedules.js`（新規 or 修正）
- `tests/api/schedules.test.js`

---

### TASK-6: UI Timeline対応
**要件**: REQ-4
**優先度**: Medium
**依存**: TASK-5

- [ ] Timeline Viewでの新形式対応確認
- [ ] カレンダー由来イベントにアイコン表示（任意）
- [ ] イベント完了チェック機能確認
- [ ] 既存UIとの互換性確認

**成果物**:
- UIの動作確認完了
- 必要に応じてフロントエンド修正

---

### TASK-7: Google Calendar MCP連携基盤
**要件**: REQ-2
**優先度**: Medium
**依存**: TASK-4

- [ ] MCPサーバー設定ドキュメント作成
- [ ] カレンダーイベント → Kiro形式変換ユーティリティ
- [ ] ID生成ロジック（`event-${timestamp}`）
- [ ] 重複チェックユーティリティ（CalendarId + EventId）

**成果物**:
- `docs/google-calendar-mcp-setup.md`
- `lib/calendar-event-converter.js`（/ohayo実装者向け）

**Note**: /ohayoスキル自体の実装はスコープ外（別担当者が対応）

---

### TASK-8: ドキュメント更新
**要件**: 全体
**優先度**: Low
**依存**: TASK-1〜7

- [ ] README.md 更新（スケジュール形式説明）
- [ ] HANDOFF.md 更新（セットアップ手順）
- [ ] setup.sh 更新（_schedules サンプル作成）

**成果物**:
- README.md
- HANDOFF.md
- setup.sh

---

## 実装順序

```
TASK-1 (Parser)
    ↓
TASK-2 (デュアルモード) → TASK-3 (マイグレーション)
    ↓
TASK-4 (サーバー統合)
    ↓
TASK-5 (API) → TASK-6 (UI)
    ↓
TASK-7 (MCP基盤)
    ↓
TASK-8 (ドキュメント)
```

## 見積もり

| タスク | 規模 |
|--------|------|
| TASK-1 | 大（新規Parser） |
| TASK-2 | 中（既存修正） |
| TASK-3 | 中（スクリプト） |
| TASK-4 | 小（設定追加） |
| TASK-5 | 中（API追加） |
| TASK-6 | 小（確認中心） |
| TASK-7 | 中（MCP連携基盤） |
| TASK-8 | 小（ドキュメント） |

## 成功基準

- [ ] 全テストがパス
- [ ] カバレッジ80%以上
- [ ] マイグレーションでデータ損失なし
- [ ] UI表示が正常
- [ ] MCP連携基盤が整備され、/ohayo実装者が利用可能
- [ ] 後方互換性維持（旧形式も読み取り可）
