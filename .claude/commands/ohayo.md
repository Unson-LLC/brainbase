# ohayo

朝のインプット整理ルーティン。今日の予定・メール・フォーカスに加えて、前日までに止まった運用キューを確認する。

## トリガー

- `/ohayo`
- ユーザーが「おはよう」「今日の整理」「朝の確認」と言及

## Archive Blocked Check

毎朝必ず archive finalizer の blocked 件数を確認する。

```bash
cd /Users/ksato/workspace/code/brainbase
node scripts/archive-blocked-report.mjs --limit 5
```

扱い:

- blocked が 0 件: 件数だけ報告
- blocked が 1 件以上: 件数、上位5件、最古経過時間、主な理由を朝のブリーフィングに載せる
- `/ohayo` では原則として解消作業は始めず、今日のフォーカス候補に入れる

## Calendar Check

毎朝必ず `gog` で今日のカレンダーを確認する。

最低限の確認:

```bash
TODAY=$(date +%F)
TOMORROW=$(date -v+1d +%F)
gog calendar events primary --from "${TODAY}T00:00:00+09:00" --to "${TOMORROW}T00:00:00+09:00" --json --no-input
```

必要に応じて直近7日も確認する:

```bash
TODAY=$(date +%F)
NEXT_WEEK=$(date -v+7d +%F)
gog calendar events primary --from "${TODAY}T00:00:00+09:00" --to "${NEXT_WEEK}T00:00:00+09:00" --json --no-input
```

扱い:

- 今日の予定が 0 件: 0件と報告
- 今日の予定が 1 件以上: 時刻、件名、相手、準備が必要なもの、移動/衝突リスクを朝のブリーフィングに載せる
- 予定の作成・更新・返信は勝手に実行せず、必要なら提案またはドラフト化する
- 認証エラーの場合は `gog auth list --check` で状態を確認し、未認証ならセットアップ不足として報告する

## Mail Check

毎朝必ず `gog` で Gmail の未処理メールを確認する。

最低限の確認:

```bash
gog gmail search "in:inbox is:unread newer_than:3d" --max 20 --json --no-input
gog gmail search "in:inbox is:important newer_than:7d" --max 20 --json --no-input
gog gmail search "in:inbox is:starred newer_than:7d" --max 20 --json --no-input
```

スレッド本文の確認が必要な場合:

```bash
gog gmail thread get <threadId> --json --no-input
```

扱い:

- 未処理メールが 0 件: 0件と報告
- 未処理メールが 1 件以上: 送信者、件名、要約、必要アクション、期限が見えるものを朝のブリーフィングに載せる
- 返信や送信は勝手に実行せず、必要ならドラフトまたはタスク化する
- Gmail検索結果だけで判断しきれないものは thread を開いて本文を確認する
- 認証エラーの場合は `gog auth list --check` で状態を確認し、未認証ならセットアップ不足として報告する

## Slack Check

毎朝必ず `slack-mentions` skill に従って、佐藤圭吾宛のSlackメンション・DMを確認する。

最低限の確認:

1. User ID検索で全チャンネル横断メンションを拾う

```text
slack_search_public_and_private(query="<@U08FB9S7HUL>", sort="timestamp", count=20)
```

2. メンションなしDMを補完するため、主要DMを直接読む

```text
slack_read_channel(channel_id="D08FB9SB97W", limit=10)  # 堀さんDM
slack_read_channel(channel_id="D09GQSYG42H", limit=10)  # 渡邊さんDM
slack_read_channel(channel_id="D0A264FGG65", limit=5)   # mana DM
```

3. スレッド文脈が必要なものだけ展開する

```text
slack_read_thread(channel_id="<channel_id>", message_ts="<parent_ts>")
```

扱い:

- 未対応メンション/DMが 0 件: 0件と報告
- 未対応メンション/DMが 1 件以上: 送信者、チャンネル/DM、要約、必要アクションを朝のブリーフィングに載せる
- 返信や送信が必要な場合は、勝手に送らずドラフトまたはタスク化する
- Slack検索APIだけを信用せず、主要DMの直接確認で補完する

## 関連トリガー

| コマンド | 役割 |
|---|---|
| `/ohayo` | 検知: カレンダー、メール、Slack未対応連絡、blocked 件数を朝に必ず見える化 |
| `/oyasumi` | 日次整理: 当日分を fix/retry/task 化 |
| `/retro` | 週次棚卸し: 残った blocked を Block としてエスカレーション |
