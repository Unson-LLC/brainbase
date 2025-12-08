# おはようダッシュボード

仕事開始時に実行する朝のセットアップコマンド。
同期 → 現状把握 → AI提案 → フォーカス確定 の流れで1日をスタート。

## 実行手順

### Phase 0: リポジトリ同期

まず全リポジトリを最新状態に同期：

1. **必ず `/Users/ksato/workspace` ディレクトリから** `_ops/update-all-repos.sh` を実行
   - worktreeから実行する場合: `cd /Users/ksato/workspace && ./_ops/update-all-repos.sh`
   - スクリプトはカレントディレクトリからの相対パスで `.git` を探すため、worktreeから直接実行すると失敗する
2. dirtyなリポジトリがあれば報告（コミット/stash提案）
3. pull失敗があれば報告

※ 同期中に Phase 1 の情報収集を並列で開始してOK

### Phase 1: 情報収集（並列実行）

以下を **並列で** 取得：

1. **今日の日付・時刻**
   - `mcp__google-calendar__get-current-time` で現在時刻を取得

2. **今日のカレンダー**
   - `mcp__google-calendar__list-events` で今日の予定を取得
   - account: "unson"（k.sato.unson@gmail.comアカウント）
   - calendarId: 以下の7つを配列で指定
     - "k.sato.unson@gmail.com"
     - "k.sato.ncom@gmail.com"
     - "k.sato@sales-tailor.jp"
     - "k.sato.baao@gmail.com"
     - "k.sato.knllc@gmail.com"
     - "k0127s@gmail.com"
     - "sin310135@gmail.com"
   - timeMin/timeMax: 今日の0:00〜23:59
   - timeZone: "Asia/Tokyo"

3. **未完了タスク**
   - `_tasks/index.md` を読み込み
   - status が `pending` または `in_progress` のものを抽出

4. **昨日の活動**
   - `git log --since="yesterday 00:00" --until="today 00:00" --oneline` で昨日のコミットを取得

5. **Slack未対応メンション**
   - `_inbox/pending.md` を読み込み
   - status が `pending` のものを抽出
   - 自分宛メンション（@k.sato）を優先表示

6. **未読メール**
   - `mcp__gmail__gmail_list_messages` で未読メールを取得
   - query: "is:unread"
   - maxResults: 10
   - 対象アカウント（役割）:
     - info@unson.jp（雲孫）
     - k.sato@sales-tailor.jp（SalesTailor）
     - sin310135@gmail.com（Tech Knight）
   - 重要度の高いもの（請求書、顧客からの連絡等）を優先表示
   - 自動通知（Vercel、Amazon等）は件数のみ

### Phase 2: サマリー出力

以下のフォーマットで出力：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☀️ おはよう｜{曜日} {月/日}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 今日の予定: {件数}件
{予定がある場合は時刻と内容を箇条書き、なければ「MTGなし」}

📋 未完了タスク: {件数}件
{上位3件を表示、4件以上あれば「他{n}件」}

📊 昨日の活動: {コミット数}件
{直近3件のコミットメッセージ要約}

💬 Slack未対応: {件数}件
{未対応メンションの概要を箇条書き、送信者・チャンネル・要約}

📧 未読メール: {件数}件
{重要なメールを箇条書き、送信者・件名・アカウント}
{自動通知は「他{n}件（Vercel, Amazon等）」でまとめる}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Phase 3: フォーカス提案

タスク・カレンダー・昨日の活動・**Slackメンション・メール**から **今日の最優先事項** をAIが1つ提案：

```
💡 今日のフォーカス提案:
「{提案内容}」

理由: {なぜこれを優先すべきか1文で}
```

### Phase 4: 確認

AskUserQuestion で確認：
- 「この提案で進めますか？」
- 選択肢: 「OK」「別のタスクを優先」「今日はノープラン」

ユーザーが「別のタスク」を選んだ場合は、タスク一覧から選択させる。

### Phase 5: 締め

確定したフォーカスを表示：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 今日のフォーカス: {確定した内容}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
では、始めましょう。
```

### Phase 6: スケジュールファイル保存

Phase 2のサマリー情報を元に、以下のフォーマットでファイルを作成：

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

**Priority High**
- [ ] タスク名

**進行中**
- [ ] タスク名

**その他**
- [ ] タスク名

### Slack未対応
| 時刻 | チャンネル | 送信者 | 概要 |
|------|-----------|--------|------|
| HH:MM | #channel | 名前 | 要約 |

### 未読メール（要対応）
| 送信者 | 件名 | アカウント |
|--------|------|-----------|
| 名前 | 件名 | 雲孫/SalesTailor/TechKnight |
```

保存先: `/Users/ksato/workspace/_schedules/YYYY-MM-DD.md`

保存後、ユーザーに「保存しました: _schedules/YYYY-MM-DD.md」と通知。

## 注意事項

- カレンダーAPIが失敗した場合は「カレンダー取得失敗」と表示して続行
- タスクファイルがない場合は「タスクなし」として続行
- 出力は簡潔に。詳細が必要ならユーザーが聞く
- スケジュールファイルは必ず作成する（ノープランの場合も）
