# Requirements Document

## Project Description (Input)
schedule-kiro-migration - スケジュール機能のKiro形式への統合とGoogle Calendar MCP連携対応

## 背景

### 現状の課題
1. `_schedules/YYYY-MM.md` または `YYYY-MM-DD.md` 形式でスケジュールを管理
2. タスク管理（Kiro形式）とスケジュール管理で形式が異なる
3. /ohayoコマンドのGoogle Calendar連携が未実装
4. カレンダーから取得した予定をタスクとして取り込む仕組みがない

### 目標
- スケジュール管理をKiro形式に統合し、タスク管理と一貫した構造にする
- Google Calendar MCPとの連携基盤を整備

**スコープ外**: /ohayoコマンドの実装（別担当者が対応）

## Requirements

### REQ-1: スケジュールのKiro形式移行
**EARS形式**: When ユーザーがスケジュールを管理する時, the system shall Kiro形式のディレクトリ構造でスケジュールを保存する

**詳細**:
- `_schedules/{YYYY-MM-DD}/` ディレクトリ構造
- `schedule.md` - その日のスケジュール
- `events.md` - カレンダーイベント（MCP連携用）

**形式例**:
```markdown
# _schedules/2025-01-12/schedule.md
- [ ] 10:00-11:00 定例MTG
  - _ID: event-1736650800000_
  - _Source: google-calendar_
  - _CalendarId: primary_
- [ ] 14:00-15:00 クライアント打ち合わせ
  - _ID: event-1736665200000_
  - _Source: manual_
```

### REQ-2: Google Calendar MCP連携基盤
**EARS形式**: When /ohayoコマンドが実行された時, the system shall Google Calendar MCPを通じて今日の予定を取得できる状態である

**詳細**:
- MCPサーバー設定のドキュメント整備
- カレンダーイベント→スケジュール変換ロジック
- 重複チェック（同じイベントIDは追加しない）

**データフロー**:
```
Google Calendar API
       ↓ (MCP)
   Claude Code
       ↓ (/ohayo skill)
  ScheduleParser.addFromCalendar()
       ↓
  _schedules/YYYY-MM-DD/schedule.md
       ↓
  Brainbase UI (タイムライン表示)
```

### REQ-3: ScheduleParser Kiro形式対応
**EARS形式**: The system shall 既存のScheduleParserをKiro形式に対応させる

**詳細**:
- `useKiroFormat` オプション追加（TaskParserと同様）
- 日付ベースのディレクトリ構造対応
- イベントのCRUD操作
- Source（google-calendar/manual）による分類

### REQ-4: UI対応
**EARS形式**: When スケジュールがKiro形式で保存されている時, the system shall UIでタイムラインとして表示できる

**詳細**:
- 既存のタイムライン表示との互換性維持
- カレンダー由来イベントにアイコン表示
- イベントの完了/未完了チェック

### REQ-5: マイグレーションスクリプト
**EARS形式**: The system shall 既存の_schedules/をKiro形式に変換するスクリプトを提供する

**詳細**:
- `npm run migrate:schedules` コマンド
- YYYY-MM.md → YYYY-MM-DD/schedule.md 変換
- バックアップ作成

## 優先順位

| REQ | 優先度 | 理由 |
|-----|--------|------|
| REQ-1 | High | 基盤となるデータ構造 |
| REQ-3 | High | REQ-1の実装に必要 |
| REQ-5 | High | 既存データの移行 |
| REQ-4 | Medium | UI表示の互換性 |
| REQ-2 | Medium | MCP連携基盤（/ohayo実装者向け） |

## 依存関係

```
REQ-1 (データ構造)
   ↓
REQ-3 (Parser) → REQ-5 (Migration)
   ↓
REQ-4 (UI)
   ↓
REQ-2 (MCP基盤) → [/ohayo: スコープ外]
```

## 非機能要件

- **後方互換性**: 旧形式のスケジュールも読み取り可能
- **パフォーマンス**: 日付ベースアクセスで高速化
- **拡張性**: 他のカレンダーサービス（Outlook等）への対応余地
