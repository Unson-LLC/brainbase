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

毎朝必ず `gog` で今日のカレンダーを確認する。`gog` は `--account` を付けないとデフォルトアカウントの primary calendar だけを見るため、最初に認証済みアカウントを列挙し、Calendar権限が有効な全アカウントを横断する。

認証済みアカウント確認:

```bash
gog auth list --check --json --no-input
```

2026-05時点の主要Calendar取得対象:

| account | 用途 |
|---|---|
| `info@unson.jp` | Unson/BackOffice代表 |
| `k.sato.unson@gmail.com` | Unson個人 |
| `k.sato@sales-tailor.jp` | SalesTailor |
| `k0127s@gmail.com` | 個人/開発通知 |
| `sin310135@gmail.com` | TechKnight |

※ `gog auth list --check` の結果が増減した場合は、表より実結果を優先する。

最低限の確認:

```bash
TODAY=$(date +%F)
TOMORROW=$(date -v+1d +%F)
for ACCOUNT in info@unson.jp k.sato.unson@gmail.com k.sato@sales-tailor.jp k0127s@gmail.com sin310135@gmail.com; do
  gog --account "$ACCOUNT" calendar events primary --from "${TODAY}T00:00:00+09:00" --to "${TOMORROW}T00:00:00+09:00" --json --no-input
done
```

必要に応じて直近7日も確認する:

```bash
TODAY=$(date +%F)
NEXT_WEEK=$(date -v+7d +%F)
for ACCOUNT in info@unson.jp k.sato.unson@gmail.com k.sato@sales-tailor.jp k0127s@gmail.com sin310135@gmail.com; do
  gog --account "$ACCOUNT" calendar events primary --from "${TODAY}T00:00:00+09:00" --to "${NEXT_WEEK}T00:00:00+09:00" --json --no-input
done
```

扱い:

- 今日の予定が 0 件: 0件と報告
- 今日の予定が 1 件以上: 時刻、件名、相手、準備が必要なもの、移動/衝突リスクを朝のブリーフィングに載せる
- HTMLレポートの各予定 item には Calendar の `htmlLink` または開けるURLを `links` に必ず入れる。複数アカウント横断時は対象アカウントを evidence に残す
- 予定の作成・更新・返信は勝手に実行せず、必要なら提案またはドラフト化する
- 認証エラーの場合は `gog auth list --check` で状態を確認し、未認証ならセットアップ不足として報告する

## Mail Check

毎朝必ず `gog` で Gmail の未処理メールを確認する。`gog` は `--account` を付けないとデフォルトアカウントしか見ないため、最初に認証済みアカウントを列挙し、Gmail権限が有効な全アカウントを横断する。

認証済みアカウント確認:

```bash
gog auth list --check --json --no-input
```

2026-05時点の主要Gmail取得対象:

| account | 用途 |
|---|---|
| `info@unson.jp` | Unson/BackOffice代表 |
| `k.sato.unson@gmail.com` | Unson個人 |
| `k.sato@sales-tailor.jp` | SalesTailor |
| `k0127s@gmail.com` | 個人/開発通知 |
| `sin310135@gmail.com` | TechKnight |

※ `gog auth list --check` の結果が増減した場合は、表より実結果を優先する。

最低限の確認:

```bash
for ACCOUNT in info@unson.jp k.sato.unson@gmail.com k.sato@sales-tailor.jp k0127s@gmail.com sin310135@gmail.com; do
  gog --account "$ACCOUNT" gmail search "in:inbox is:unread newer_than:3d" --max 20 --json --no-input
  gog --account "$ACCOUNT" gmail search "in:inbox is:important newer_than:7d" --max 20 --json --no-input
  gog --account "$ACCOUNT" gmail search "in:inbox is:starred newer_than:7d" --max 20 --json --no-input
done
```

スレッド本文の確認が必要な場合:

```bash
gog --account "$ACCOUNT" gmail thread get <threadId> --json --no-input
```

扱い:

- 未処理メールが 0 件: 0件と報告
- 未処理メールが 1 件以上: 送信者、件名、要約、必要アクション、期限が見えるものを朝のブリーフィングに載せる
- 検索結果はアカウント別に raw ledger として残し、HTML生成前に「各アカウントの `unread3d` / `important7d` / `starred7d` の全件」が、(a)個別item化、(b)同種itemに統合、(c)ノイズとして明示除外、のどれかに分類済みであることを確認する。件数サマリだけで済ませない
- HTMLレポートの各メール item には Gmail で開ける thread link を `links` に必ず入れる。リンクは `https://mail.google.com/mail/?authuser=<account>#all/<threadId>` を優先し、threadId と account を evidence に残す。複数アカウント横断時は `mail/u/0` 固定だけに頼らず、対象アカウントも明記する。
- evidence の `gmail_thread_id` をレポート生成器が自動リンク化する場合は、説明文を混ぜず純粋なIDだけを入れる。説明は `gmail_subject` など別 evidence に分ける
- 返信や送信は勝手に実行せず、必要ならドラフトまたはタスク化する
- Gmail検索結果だけで判断しきれないものは thread を開いて本文を確認する
- 認証エラーの場合は `gog auth list --check` で状態を確認し、未認証ならセットアップ不足として報告する

## Slack Check

毎朝必ず `slack-mentions` skill に従って、佐藤圭吾宛のSlackメンション・DMを直近3日分確認する。目的は「今日来たもの」ではなく「直近3日で返信すべきなのに未対応のもの」を拾うこと。Slackは1ワークスペースではなく、少なくとも `salestailor` / `unson` / `techknight` の3ワークスペースを横断する。

取得前に必ず Slack MCP の起動前チェックを実行する。

```bash
cd /Users/ksato/workspace/code/brainbase
scripts/check-slack-mcp-health.sh
```

扱い:

- 3ワークスペースすべて `ok` の場合だけ、以下のSlack取得に進む
- `blocked` / `SLACK_MCP_UNAVAILABLE` が出た場合は、Slack未対応件数を 0 件として扱わず「Slack未確認」として HTML レポートとブリーフィングに明記する
- 失敗理由は secret 値を出さず、workspace名、失敗した前提（token file missing / Infisical access denied / missing key / binary missing など）だけを evidence に残す

ワークスペース別 User ID:

| workspace | MCP namespace | 佐藤圭吾 User ID |
|---|---|---|
| salestailor | `mcp__slack_salestailor__` | `U08FB9S7HUL` |
| unson | `mcp__slack_unson__` | `U07LNUP582X` |
| techknight | `mcp__slack_techknight__` | `U07B19N048G` |

最低限の確認:

1. 各ワークスペースの User ID検索で直近3日分の全チャンネル横断メンションを拾う

```text
salestailor: slack_search_public_and_private(query="<@U08FB9S7HUL>", filter_date_after="<3日前の日付 YYYY-MM-DD>", sort="timestamp", count=50)
unson: slack_search_public_and_private(query="<@U07LNUP582X>", filter_date_after="<3日前の日付 YYYY-MM-DD>", sort="timestamp", count=50)
techknight: slack_search_public_and_private(query="<@U07B19N048G>", filter_date_after="<3日前の日付 YYYY-MM-DD>", sort="timestamp", count=50)
```

2. メンションなしDMを補完するため、主要DMを直近3日分直接読む。下記は salestailor の主要DM例。unson / techknight は `users_search` でDM IDを確認し、直接読めない場合は `filter_users_with=<workspace user id>` で補完して evidence に制限を残す。

```text
slack_read_channel(channel_id="D08FB9SB97W", limit=50)  # 堀さんDM
slack_read_channel(channel_id="D09GQSYG42H", limit=50)  # 渡邊さんDM
slack_read_channel(channel_id="D0A264FGG65", limit=20)  # mana DM
```

3. 返信済み/未対応の判定に必要なスレッドだけ展開する

```text
slack_read_thread(channel_id="<channel_id>", message_ts="<parent_ts>")
```

扱い:

- 未対応メンション/DMが 0 件: 0件と報告
- 未対応メンション/DMが 1 件以上: 送信者、チャンネル/DM、要約、必要アクションを朝のブリーフィングに載せる
- 未対応判定は、依頼・質問・確認待ち・判断待ち・返信要求があり、その後に各ワークスペースの佐藤圭吾 User ID による返信または明示的な完了反応が見つからないものを対象にする
- HTMLレポートの各Slack item には Slack permalink（可能なら `https://<workspace>.slack.com/archives/<channel>/p<ts>`）を `links` に必ず入れる。permalinkが作れない場合も channel_id / ts / thread_ts を evidence に残す
- 返信や送信が必要な場合は、勝手に送らずドラフトまたはタスク化する
- Slack検索APIだけを信用せず、主要DMの直接確認で補完する

## SNS Ohayo Brief

SNS運用は `/ohayo` に寄せる。毎朝、週次編集カレンダーを前提に「今日のベースライン2本」と「ニュース/引用差し込み1〜2本」を決める。

```bash
cd /Users/ksato/workspace/code/brainbase
TODAY=$(date +%F)
CONTEXT_FILE="/Users/ksato/workspace/shared/_codex/sns/x/ops/generation-contexts/${TODAY}.json"
npm run sns:generation-context -- \
  --date "$TODAY" \
  --out "$CONTEXT_FILE"

npm run sns:ohayo-brief -- \
  --date "$TODAY" \
  --since 1d \
  --max-results 10 \
  --limit 5 \
  --generation-context "$CONTEXT_FILE"

npm run sns:import-review-pack -- --date "$TODAY"
```

出力:

| 出力 | 場所 |
|---|---|
| 人間レビュー用brief | `/Users/ksato/workspace/shared/_codex/sns/x/ops/daily-briefs/YYYY-MM-DD.md` |
| weekly pack投入用signals | `/Users/ksato/workspace/shared/_codex/sns/x/ops/daily-briefs/YYYY-MM-DD-signals.json` |
| AI生成用context | `/Users/ksato/workspace/shared/_codex/sns/x/ops/generation-contexts/YYYY-MM-DD.json` |
| UI用SNS Posting Ledger | `POST /api/sns-growth/review-pack` 経由で `GET /api/sns-growth/posts?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` に反映 |

扱い:

- X検索は低コスト固定。既定は日本語Peer 10 read + 海外/ニュース 10 read、概算 `$0.10/day`
- Peer候補は「日本語圏、自分と同格〜少し上、相手が拾いやすい論点」を優先する
- 投稿生成前にSNS Generation Contextを作り、個人KG / SNS Posting Ledger統計 / feedback learning / SNS Strategy OSを生成方針へ反映する
- APIの `quote_tweet_id` は使わず、本物の引用UIまたは通常投稿末尾の元URLで扱う
- `Persona Affect: blocked` が1件でもあれば、その本文は投稿対象にしない
- 投稿本文に「少し上の人に絡む」「相手の読者に入る」など運用意図を書かない
- `sns:import-review-pack` は生成済み review pack を SNS Posting Ledger へ取り込むだけで、X/Slack等への投稿は行わない
- Ledger import 後、可能なら `GET /api/sns-growth/posts?startDate=$TODAY&endDate=$TODAY` で件数を確認し、HTMLレポートの SNS item に `created` / `updated` / UI表示件数を載せる
- Ledger import が失敗した場合は、SNS投稿候補を 0 件として扱わず「SNS Ledger未投入」として HTML レポートとブリーフィングに明記する
- 投稿は manual review only。`/ohayo` では投稿実行しない

## HTML Report

Calendar / Mail / Slack / Archive Blocked / 今日の優先タスクを整理したら、日付別HTMLレポートを必ず生成する。

```bash
TODAY=$(date +%F)
node scripts/daily-ops-report.mjs ohayo \
  --date "$TODAY" \
  --input "/tmp/ohayo-${TODAY}.json"
```

各 item には可能な限り `links` を入れる。Calendar は `htmlLink`、Mail は Gmail thread link、Slack は permalink を優先する。
証跡は Slack channel/thread ts、Gmail thread id、Calendar event id、NocoDB table/record など、後で追える粒度で `evidence` に残す。
HTML内のボタンはAIに渡す構造化指示だけを生成する。Slack投稿・NocoDB更新など外部副作用は既定で `draft_only` / `dry_run` とし、実送信・実更新は別確認なしに行わない。

## 関連トリガー

| コマンド | 役割 |
|---|---|
| `/ohayo` | 検知: カレンダー、メール、Slack未対応連絡、blocked 件数、SNS当日briefとPosting Ledger取り込みを朝に必ず見える化 |
| `/oyasumi` | 日次整理: 当日分を fix/retry/task 化し、SNS反応を学習に戻す |
| `/retro` | 週次棚卸し: 残った blocked とSNS勝ち筋を Learn/Block としてエスカレーション |
