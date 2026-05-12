# retro

週次振り返り（Ship/Learn/Block）を実行し、結果を Wiki SSOT に保存するコマンド。

## トリガー

- `/retro`
- ユーザーが「振り返りして」「今週のレトロ」と言及

## 実行フロー

1. **今週のShipを収集**
   - NocoDB ストーリーテーブルから `ステータス=completed` かつ直近7日を抽出
   - git log から直近7日のマージコミットを抽出

2. **今週のWorkを集計**
   - NocoDB ストーリーテーブルから `ステータス=active` の進捗率変化を確認
   - ブロッカー欄が埋まっているタスクを抽出
   - archive finalizer の blocked を抽出

   ```bash
   cd /Users/ksato/workspace/code/brainbase
   node scripts/archive-blocked-report.mjs --limit 50
   ```

   archive blocked は週次レトロの Block に必ず含める。残件は owner / next action / due を付け、無期限の持ち越しを禁止する。

3. **学習候補の一括レビュー** ⭐ 週次決裁ポイント

   ohayo は件数だけ報告し、apply/reject 判断はここに集約する設計。

   ```bash
   cd /Users/ksato/workspace/code/brainbase
   node cli/index.js learn inbox
   ```

   全 pending 候補を一覧表示し、各候補について以下を判断:
   - **apply**: wiki/skill に昇格させる価値あり
     - `node cli/index.js learn apply <id>`
   - **reject**: ノイズ・既出・粒度不適切
     - `node cli/index.js learn reject <id>`
   - **保留**: 判断がつかない → そのまま次週に持ち越し

   レビュー結果を Learn 枠に集計（apply N件 / reject M件 / hold K件）。

4. **SNS週次学習**

   `/ohayo` の daily brief と `/oyasumi` の feedback を7日分集計し、SNS運用の勝ち筋とズレを確認する。

   入力:

   - `/Users/ksato/workspace/shared/_codex/sns/x/ops/daily-briefs/YYYY-MM-DD.md`
   - `/Users/ksato/workspace/shared/_codex/sns/x/ops/feedback/YYYY-MM-DD.md`
   - `/Users/ksato/workspace/shared/_codex/sns/content_pillars.md`
   - `/Users/ksato/workspace/shared/_codex/sns/x/ops/weekly_content_calendar_*.md`

   集計するもの:

   - Peer interaction / 引用・リプ: 7〜9本
   - Claude Code / AI PM / AI経営の理解: 5〜7本
   - Own Proof: 4〜6本
   - AI駆動経営の断定・哲学: 3〜4本
   - Learn in public: 1〜2本
   - CTA: 1〜2本

   判断:

   - Peer本人に拾われた投稿はPeer Circle候補を昇格
   - 読者に保存/プロフィール遷移された投稿は本文型を保留候補
   - Persona Affectが外れた投稿は数字が良くても勝ち型にしない
   - 一過性のバズは正本化しない
   - 再現性があるものだけ `style_guide.md` / `content_pillars.md` / skill / Graph更新候補にする

5. **振り返りレポート生成**
   ```markdown
   # Weekly Retro: YYYY-MM-DD

   ## 🚀 Ship（出荷）
   - [項目]: [概要]

   ## 📚 Learn（学習）
   - [項目]: [学び]
   - SNS: [勝ち筋 / 弱い型 / 次週の変更]

   ## 🔴 Block（ブロッカー）
   - [項目]: [状況と対応方針]
   - Archive blocked: [件数]件
     - [session-id]: [reason] → [owner / next action / due]

   ## 📊 メトリクス
   - Ship数: X件
   - Work→Ship率: X%
   - ブロッカー数: X件
   ```

6. **詳細レポートを Wiki SSOT に保存（永続）**
   ```bash
   # /tmp/retro は中間成果物（揮発OK）
   mkdir -p /tmp/retro
   # まず /tmp に書き出してから Wiki に POST する
   ```

   Wiki 投入:
   ```bash
   TOKEN=$(cat ~/.brainbase/tokens.json | jq -r .access_token)
   jq -Rs --arg p "_common/retros/YYYY-MM-DD" '{path:$p, content:.}' \
     < /tmp/retro/weekly_report_YYYY-MM-DD.md > /tmp/wiki-retro.json
   curl -s -X POST "http://localhost:31013/api/wiki/page" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     --data-binary "@/tmp/wiki-retro.json"
   ```

## 出力先

| 出力 | パス | 永続化 |
|------|------|------|
| **詳細レポート（正本）** | Wiki `_common/retros/YYYY-MM-DD` (`localhost:31013/api/wiki/page`) | ✅ Wiki SSOT |
| 中間成果物 | `/tmp/retro/weekly_report_{YYYY-MM-DD}.md` | ❌ 揮発（再起動で消える） |

正本は Wiki SSOT。`/tmp` は中間成果物として一時的に置くだけ。

## 注意

- Ship = 「外部に価値が到達した」もののみ（ドラフト生成 ≠ Ship）
- Learn は wiki/skill に **apply 済み** のもののみカウント（pending は count しない）
- Block は現在進行中のブロッカーのみ
- Archive blocked は `/ohayo` で検知、`/oyasumi` で日次整理、`/retro` で週次エスカレーションする
- SNSは `/ohayo` で候補収集、`/oyasumi` で反応学習、`/retro` で勝ち筋だけ正本化する

## 学習候補の補給ルート

学習候補は2系統で自動投入される:

| ソース | トリガー | 投入経路 |
|---|---|---|
| explicit | ユーザーが `/learn` を呼んだ時 | `brainbase learn add` |
| auto-extract | /commit 完了 + launchd `com.brainbase.learn-extractor`（2h毎） | codex exec で transcript 分析 → `brainbase learn add` |

`/retro` 実行時、`learn inbox` には両系統の pending が混ざって表示される。
