# 技術設計書: schedule-kiro-migration

## 概要

スケジュール管理をKiro形式（日付ベースのディレクトリ構造）に移行し、Google Calendar MCPとの連携基盤を整備する。

## アーキテクチャ

### データフロー

```mermaid
flowchart TD
    subgraph External
        GC[Google Calendar API]
    end

    subgraph MCP
        GCMCP[Google Calendar MCP Server]
    end

    subgraph ClaudeCode
        OHAYO[/ohayo skill]
    end

    subgraph Backend
        SP[ScheduleParser]
        KSP[KiroScheduleParser]
        API[REST API]
    end

    subgraph Storage
        OLD[_schedules/YYYY-MM.md]
        NEW[_schedules/YYYY-MM-DD/schedule.md]
    end

    subgraph Frontend
        UI[Timeline View]
    end

    GC --> GCMCP
    GCMCP --> OHAYO
    OHAYO --> KSP
    KSP --> NEW
    SP --> OLD
    KSP --> API
    API --> UI
```

### ディレクトリ構造（After）

```
_schedules/
├── 2025-01-12/
│   └── schedule.md
├── 2025-01-13/
│   └── schedule.md
└── 2025-01/           # マイグレーション後も残す（後方互換）
    └── (archive)
```

### ファイルフォーマット

```markdown
# schedule.md
- [ ] 10:00-11:00 定例MTG
  - _ID: event-1736650800000_
  - _Source: google-calendar_
  - _CalendarId: primary_
- [ ] 14:00-15:00 クライアント打ち合わせ
  - _ID: event-1736665200000_
  - _Source: manual_
- [x] 09:00-09:30 朝会
  - _ID: event-1736647800000_
  - _Source: google-calendar_
```

## コンポーネント設計

### 1. KiroScheduleParser (新規)

**ファイル**: `lib/kiro-schedule-parser.js`

```javascript
export class KiroScheduleParser {
    constructor(schedulesDir) {
        this.schedulesDir = schedulesDir;
    }

    // 日付ディレクトリのパス取得
    getDateDir(date) {
        return path.join(this.schedulesDir, date);
    }

    // スケジュール読み込み
    async getSchedule(date) {
        const filePath = path.join(this.getDateDir(date), 'schedule.md');
        // パース処理
    }

    // イベント追加（重複チェック付き）
    async addEvent(date, event) {
        // ID重複チェック
        // ファイル書き込み
    }

    // イベント更新
    async updateEvent(date, eventId, updates) {}

    // イベント削除
    async deleteEvent(date, eventId) {}

    // イベントシリアライズ
    serializeEvent(event) {
        const checkbox = event.completed ? '[x]' : '[ ]';
        const lines = [`- ${checkbox} ${event.start}-${event.end} ${event.title}`];
        lines.push(`  - _ID: ${event.id}_`);
        lines.push(`  - _Source: ${event.source}_`);
        if (event.calendarId) {
            lines.push(`  - _CalendarId: ${event.calendarId}_`);
        }
        return lines.join('\n') + '\n';
    }
}
```

### 2. ScheduleParser 拡張

**ファイル**: `lib/schedule-parser.js`

```javascript
export class ScheduleParser {
    constructor(schedulesDir, options = {}) {
        this.schedulesDir = schedulesDir;
        this.useKiroFormat = options.useKiroFormat || false;

        if (this.useKiroFormat) {
            this.kiroParser = new KiroScheduleParser(schedulesDir);
        }
    }

    async getTodaySchedule() {
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

        if (this.useKiroFormat) {
            return this.kiroParser.getSchedule(today);
        }

        // 既存ロジック（後方互換）
        return this._getLegacySchedule(today);
    }
}
```

### 3. カレンダーイベント変換ユーティリティ

**ファイル**: `lib/calendar-event-converter.js`

```javascript
// /ohayo実装者向けのユーティリティ
export class CalendarEventConverter {
    // Google Calendar APIレスポンス → Kiro形式イベント変換
    static fromGoogleEvent(gcEvent) {
        return {
            id: `event-${Date.now()}`,
            start: this._formatTime(gcEvent.start),
            end: this._formatTime(gcEvent.end),
            title: gcEvent.summary,
            source: 'google-calendar',
            calendarId: gcEvent.calendarId || 'primary',
            completed: false
        };
    }

    // 重複チェック
    static isDuplicate(existingEvents, newEvent) {
        return existingEvents.some(e =>
            e.source === 'google-calendar' &&
            e.calendarId === newEvent.calendarId &&
            e.start === newEvent.start &&
            e.title === newEvent.title
        );
    }
}
```

**Note**: /ohayoスキル自体の実装はスコープ外（別担当者が対応）

### 4. マイグレーションスクリプト

**ファイル**: `scripts/migrate-schedules-to-kiro.js`

```javascript
// 処理フロー
// 1. _schedules/*.md を走査
// 2. 日付セクション（### YYYY-MM-DD）を抽出
// 3. 各日付のディレクトリ作成
// 4. schedule.md に変換・保存
// 5. 元ファイルはバックアップ（_schedules-backup/）
```

## API設計

### エンドポイント

| Method | Path | 説明 |
|--------|------|------|
| GET | /api/schedules/today | 今日のスケジュール取得 |
| GET | /api/schedules/:date | 指定日のスケジュール取得 |
| POST | /api/schedules/:date/events | イベント追加 |
| PUT | /api/schedules/:date/events/:id | イベント更新 |
| DELETE | /api/schedules/:date/events/:id | イベント削除 |

### レスポンス形式

```json
{
  "date": "2025-01-12",
  "events": [
    {
      "id": "event-1736650800000",
      "start": "10:00",
      "end": "11:00",
      "title": "定例MTG",
      "source": "google-calendar",
      "calendarId": "primary",
      "completed": false
    }
  ]
}
```

## 環境変数

```bash
# .env
KIRO_SCHEDULE_FORMAT=true    # Kiro形式を有効化
GOOGLE_CALENDAR_MCP=true     # Google Calendar MCP連携を有効化
```

## 後方互換性

1. **KIRO_SCHEDULE_FORMAT=false** で旧形式にフォールバック
2. マイグレーション中も旧ファイルは読み取り可能
3. 1ヶ月の並行運用期間を設ける

## テスト戦略

### ユニットテスト
- KiroScheduleParser.parseSchedule()
- KiroScheduleParser.serializeEvent()
- 重複チェックロジック

### 統合テスト
- API経由のCRUD操作
- マイグレーションスクリプト

### E2E（手動）
- UI Timeline表示確認
- マイグレーション後のデータ確認

## 依存関係

```mermaid
graph TD
    REQ1[REQ-1: データ構造] --> REQ3[REQ-3: Parser]
    REQ3 --> REQ5[REQ-5: Migration]
    REQ3 --> REQ4[REQ-4: UI]
    REQ4 --> REQ2[REQ-2: MCP基盤]
    REQ2 --> OHAYO[/ohayo: スコープ外]
    style OHAYO fill:#ccc,stroke:#999
```

## リスクと対策

| リスク | 対策 |
|--------|------|
| マイグレーション時のデータ損失 | バックアップ必須、ドライラン機能 |
| MCP接続エラー | フォールバック（手動入力許可） |
| パフォーマンス低下 | 日付ベースアクセスで改善見込み |
