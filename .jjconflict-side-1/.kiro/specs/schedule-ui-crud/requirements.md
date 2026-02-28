# Requirements Document

## Project Description
schedule-ui-crud - スケジュールイベントのUI操作（追加・編集・削除・完了）機能

## 背景

### 現状の課題
1. ScheduleServiceは読み取り専用（`loadSchedule()`のみ）
2. TimelineViewは表示のみでインタラクティブ要素がない
3. バックエンドAPIは完成しているがUIから呼び出せない
4. イベントの追加・編集・削除・完了チェックができない

### 目標
- UIからスケジュールイベントのCRUD操作を可能にする
- 既存のタスク管理UIパターン（TaskAddModal等）に合わせたUX
- EventBus/Store経由のリアクティブな更新

## Requirements

### REQ-1: イベント追加機能
**EARS形式**: When ユーザーがスケジュール追加ボタンをクリックした時, the system shall イベント追加モーダルを表示し新規イベントを作成できる

**詳細**:
- タイムラインビューに「+」ボタン追加
- モーダルで時間（開始・終了）とタイトルを入力
- POST /api/schedule/:date/events API呼び出し
- 成功後、SCHEDULE_UPDATEDイベント発火

**入力項目**:
- 開始時間（必須）: HH:MM形式
- 終了時間（任意）: HH:MM形式
- タイトル（必須）: テキスト

### REQ-2: イベント完了チェック機能
**EARS形式**: When ユーザーがイベントをクリックした時, the system shall 完了/未完了を切り替える

**詳細**:
- タイムラインアイテムにクリックイベント追加
- PUT /api/schedule/:date/events/:id API呼び出し（completed: true/false）
- 完了イベントは打ち消し線で表示

### REQ-3: イベント編集機能
**EARS形式**: When ユーザーがイベントをダブルクリックした時, the system shall 編集モーダルを表示しイベントを編集できる

**詳細**:
- ダブルクリックで編集モーダルを開く
- 時間・タイトルの変更
- PUT /api/schedule/:date/events/:id API呼び出し

### REQ-4: イベント削除機能
**EARS形式**: When ユーザーが編集モーダルで削除ボタンをクリックした時, the system shall イベントを削除する

**詳細**:
- 編集モーダルに削除ボタン
- 確認ダイアログ表示
- DELETE /api/schedule/:date/events/:id API呼び出し

### REQ-5: ScheduleService CRUD拡張
**EARS形式**: The system shall ScheduleServiceにCRUD操作メソッドを追加する

**詳細**:
- `addEvent(date, eventData)`
- `updateEvent(date, eventId, updates)`
- `deleteEvent(date, eventId)`
- `toggleEventComplete(date, eventId)`

### REQ-6: リアクティブ更新
**EARS形式**: When スケジュールが変更された時, the system shall EventBus経由でUIを自動更新する

**詳細**:
- SCHEDULE_UPDATED イベント発火
- TimelineViewが自動で再レンダリング
- Storeの状態も同期

## 優先順位

| REQ | 優先度 | 理由 |
|-----|--------|------|
| REQ-5 | High | 他の機能の基盤 |
| REQ-1 | High | 最も頻繁に使用 |
| REQ-2 | High | 簡単な操作 |
| REQ-6 | High | UX向上 |
| REQ-3 | Medium | 追加機能 |
| REQ-4 | Medium | 追加機能 |

## 依存関係

```
REQ-5 (Service拡張)
   ↓
REQ-1 (追加) → REQ-6 (リアクティブ)
   ↓
REQ-2 (完了チェック)
   ↓
REQ-3 (編集) → REQ-4 (削除)
```

## 非機能要件

- **一貫性**: TaskAddModal等と同様のUIパターン
- **アクセシビリティ**: キーボード操作対応
- **パフォーマンス**: 即座にUIを更新
