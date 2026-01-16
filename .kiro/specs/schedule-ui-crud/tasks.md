# 実装タスク: schedule-ui-crud

## タスク一覧

### TASK-1: ScheduleService CRUD拡張 ✅
**要件**: REQ-5
**優先度**: High
**依存**: なし

- [x] `addEvent(eventData)` メソッド追加
- [x] `updateEvent(eventId, updates)` メソッド追加
- [x] `deleteEvent(eventId)` メソッド追加
- [x] `toggleEventComplete(eventId)` メソッド追加
- [x] `_getTodayDate()` ヘルパー追加
- [x] `_refreshAndNotify()` ヘルパー追加
- [x] ユニットテスト作成

**成果物**:
- `public/modules/domain/schedule/schedule-service.js`（修正）
- `tests/domain/schedule/schedule-service.test.js`（8テストパス）

---

### TASK-2: TimelineView インタラクション追加 ✅
**要件**: REQ-2, REQ-3
**優先度**: High
**依存**: TASK-1

- [x] イベントに `data-event-id` 属性追加
- [x] 完了済みイベントの表示スタイル追加
- [x] 追加ボタン（+）をHTMLに追加
- [x] クリックハンドラ追加（完了トグル）
- [x] ダブルクリックハンドラ追加（編集モーダル）
- [x] 追加ボタンハンドラ追加

**成果物**:
- `public/modules/ui/views/timeline-view.js`（修正）

---

### TASK-3: ScheduleAddModal 作成 ✅
**要件**: REQ-1
**優先度**: High
**依存**: TASK-1

- [x] `schedule-add-modal.js` 新規作成
- [x] mount/open/close メソッド
- [x] フォームバリデーション
- [x] save メソッド（API呼び出し）
- [x] キーボード操作対応（Enter/Escape）

**成果物**:
- `public/modules/ui/modals/schedule-add-modal.js`（新規）

---

### TASK-4: ScheduleEditModal 作成 ✅
**要件**: REQ-3, REQ-4
**優先度**: Medium
**依存**: TASK-1

- [x] `schedule-edit-modal.js` 新規作成
- [x] open(eventId) でイベントデータ読み込み
- [x] save メソッド（更新API呼び出し）
- [x] delete メソッド（確認ダイアログ + 削除API）

**成果物**:
- `public/modules/ui/modals/schedule-edit-modal.js`（新規）

---

### TASK-5: HTML/CSSモーダル追加 ✅
**要件**: REQ-1, REQ-3, REQ-4
**優先度**: High
**依存**: なし

- [x] `index.html` に追加モーダルHTML追加
- [x] `index.html` に編集モーダルHTML追加
- [x] `styles.css` に完了済みスタイル追加
- [x] `styles.css` に追加ボタンスタイル追加
- [x] `styles.css` にホバースタイル追加

**成果物**:
- `public/index.html`（修正）
- `public/style.css`（修正）

---

### TASK-6: app.js 統合 ✅
**要件**: 全体
**優先度**: High
**依存**: TASK-2, TASK-3, TASK-4

- [x] ScheduleAddModal をインポート・初期化
- [x] ScheduleEditModal をインポート・初期化
- [x] TimelineView とモーダルの連携
- [x] コンテナ登録

**成果物**:
- `public/app.js`（修正）

---

### TASK-7: テスト・動作確認 ✅
**要件**: 全体
**優先度**: High
**依存**: TASK-1〜6

- [x] 全ユニットテスト実行（682テストパス）
- [ ] UIから追加操作確認
- [ ] UIから完了トグル確認
- [ ] UIから編集操作確認
- [ ] UIから削除操作確認

**成果物**:
- テスト結果: 50ファイル、682テストパス（2026-01-12実行）

---

## 実装順序

```
TASK-5 (HTML/CSS) + TASK-1 (Service)
    ↓
TASK-2 (TimelineView)
    ↓
TASK-3 (AddModal) + TASK-4 (EditModal)
    ↓
TASK-6 (app.js統合)
    ↓
TASK-7 (テスト)
```

## 見積もり

| タスク | 規模 |
|--------|------|
| TASK-1 | 中（Service拡張） |
| TASK-2 | 中（View修正） |
| TASK-3 | 中（Modal新規） |
| TASK-4 | 中（Modal新規） |
| TASK-5 | 小（HTML/CSS） |
| TASK-6 | 小（統合） |
| TASK-7 | 小（確認） |

## 成功基準

- [x] 全テストがパス（682テスト）
- [ ] 追加ボタンからイベント追加可能
- [ ] クリックで完了/未完了トグル可能
- [ ] ダブルクリックで編集モーダル表示
- [ ] 編集モーダルから削除可能
- [ ] リアルタイムでUI更新

**注記**: ユニットテストはすべてパス。UI動作確認は手動テストが必要。
