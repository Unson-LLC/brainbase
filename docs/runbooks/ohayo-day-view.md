# おはよう：一日の見通し作成

## 目的

起床後の佐藤さんが、情報を探し回らずに「今日どこまで進めるか」を決められ、Brainbaseが任せられた仕事をそのまま進められる状態を作る。

短い要約は認知負荷を下げるために使い、詳細を隠すためには使わない。収集した予定・メール・Slackは全件を日別HTMLで辿れるようにする。

## 収集と整理

1. `brainbase-graph-philosophy-context`に従い、今日の顧客価値、進行中の約束、権限境界をGraph SSOTから確認する。
2. `gog auth list --check --json --no-input`で利用可能なGoogleアカウントを列挙する。認証済みの全アカウントについて、JST当日のCalendarを確認する。Gmailはラベル情報から未読総数を取得し、`is:unread newer_than:7d -category:promotions -category:social -category:updates -category:forums`の要対応候補を全ページ取得する。未読総数は古い未読と自動分類を含む持ち越しとして表示する。古い未読本文や販促メールを毎朝全件走査して処理を止めない。
3. `slack-mentions`に従い、起動前チェック後に`salestailor`、`unson`、`techknight`の3ワークスペースでメンションとDMを確認する。
4. 前夜の`/oyasumi`結果、持ち越し、Graph SSOT、Personal KGを照合し、次の順に整理する。
   - `today_focus`: 今日、顧客または事業の状態をどこまで変えるか
   - `ai_actions`: Brainbaseが既存権限内でそのまま進める作業
   - `human_decisions`: 目的、価値判断、責任、追加権限など佐藤さんだけが決めること
   - `carryovers`: 前日から残る論点
5. 下記の`day_view`をJSONとして標準入力へ渡し、`node scripts/routines/run.mjs ohayo`を1回実行する。
6. CLIの結論を先に示し、生成された`var/daily-ops-reports/ohayo-YYYY-MM-DD.html`を開ける状態にする。`ai_actions`は既存権限内なら継続して実行し、外部送信・公開・購入・削除・追加権限が必要な箇所だけ止める。

```json
{
  "day_view": {
    "date": "YYYY-MM-DD",
    "summary": "今日の見通し",
    "today_focus": [{ "summary": "今日どこまで状態を変えるか" }],
    "ai_actions": [{ "summary": "Brainbaseが進めること" }],
    "human_decisions": [{ "summary": "佐藤さんが決めること" }],
    "carryovers": [{ "summary": "昨日から残ること" }],
    "calendar": [],
    "mail": [],
    "slack": [],
    "priority_tasks": [],
    "source_coverage": [
      { "source": "calendar", "status": "confirmed", "summary": "対象アカウントと取得範囲" },
      { "source": "mail", "status": "confirmed", "summary": "対象アカウントと取得範囲" },
      { "source": "slack", "status": "confirmed", "summary": "対象ワークスペースと取得範囲" }
    ]
  }
}
```

## 判定

- 確認済みの空集合だけを0件とする。
- 認証失敗、未接続、timeout、ページ未取得は`partial`または`unavailable`として対象名と影響を残す。
- `source_coverage`に`confirmed`以外が1件でもあれば、朝の表示は残してもRunnerの`status`と`coverage`を`partial`にする。
- 想起した記憶の先頭を自動的に「今日の焦点」へ昇格しない。記憶は判断根拠として表示する。
- 要約に出さなかった項目も削除せず、HTMLのCalendar、Mail、Slack、今日の優先タスクに全件を残す。
