# タイムスケジュール作成コマンド

今日のタイムスケジュールを作成します。

## 入力情報
$ARGUMENTS

## 実行手順

### 1. 現在時刻の取得
```bash
date "+%Y-%m-%d %H:%M %A"
```

### 2. Google Calendarから今日の予定を取得

以下のカレンダーから今日の予定を取得:
- k.sato.unson@gmail.com（雲孫）
- k.sato@sales-tailor.jp（SalesTailor）
- k.sato.ncom@gmail.com（ncom）
- k.sato.baao@gmail.com（BAAO）
- k0127s@gmail.com（プライベート）
- sin310135@gmail.com（TechKnight）

※ k.sato.knllc@gmail.com は使用停止のため除外

`mcp__google-calendar__list-events` を使用:
- timeMin: 今日の00:00:00
- timeMax: 今日の23:59:59
- timeZone: Asia/Tokyo

### 3. タスク情報の取得

`_tasks/index.md` から以下を抽出:
- 期限が今日または過去（期限切れ）のタスク
- priority: high のタスク
- status: todo のタスク

### 4. ユーザー入力の解析

$ARGUMENTS から以下を抽出（あれば）:
- 外出時間
- 帰宅時間
- イベント・予定
- 作業可能時間の制約

### 5. タイムスケジュール生成

以下のフォーマットで出力:

```markdown
## 今日 (MM/DD 曜日) のタイムスケジュール

### カレンダー予定
| 時間 | 予定 | カレンダー |
|------|------|-----------|
| HH:MM-HH:MM | 予定名 | カレンダー名 |

### 作業可能時間
- 午前: HH:MM 〜 HH:MM
- 午後: HH:MM 〜 HH:MM

### 今日やるべきタスク

**期限切れ（急ぎ）**
- [ ] タスク名（期限: MM/DD）

**Priority High**
- [ ] タスク名

**その他**
- [ ] タスク名
```

## 注意事項
- カレンダー予定と作業可能時間が被らないよう調整
- 期限切れタスクは最優先で表示
- ユーザーの入力（外出/帰宅時間など）を優先的に反映

### 6. ファイルへの保存

### 6. ファイルへの保存

以下のシェルコマンドを実行して、生成したタイムスケジュールをファイルに保存してください（内容は生成したMarkdownに置き換えること）:

```bash
cat <<EOF > /Users/ksato/workspace/_schedules/$(date +%Y-%m-%d).md
(ここに生成したタイムスケジュールMarkdownを挿入)
EOF
```

保存後、ユーザーに「保存しました: /Users/ksato/workspace/_schedules/$(date +%Y-%m-%d).md」と通知。
