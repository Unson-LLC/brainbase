# retro

週次振り返り（Ship/Learn/Block）を実行し、結果を _inbox/pending.md に書き込むコマンド。

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

3. **振り返りレポート生成**
   ```markdown
   # Weekly Retro: YYYY-MM-DD

   ## 🚀 Ship（出荷）
   - [項目]: [概要]

   ## 📚 Learn（学習）
   - [項目]: [学び]

   ## 🔴 Block（ブロッカー）
   - [項目]: [状況と対応方針]

   ## 📊 メトリクス
   - Ship数: X件
   - Work→Ship率: X%
   - ブロッカー数: X件
   ```

4. **_inbox/pending.md に書き込み**
   ```markdown
   ---
   id: INBOX-{timestamp}
   channel: system
   sender: agent/retro
   status: pending
   message: "週次振り返り完了: Ship X件, Learn X件, Block X件"
   ---
   ```

5. **詳細レポートを /tmp/retro/ に保存**
   ```bash
   mkdir -p /tmp/retro
   # weekly_report_{date}.md に出力
   ```

## 出力先

| 出力 | パス |
|------|------|
| Inboxエントリ | `_inbox/pending.md` に追記 |
| 詳細レポート | `/tmp/retro/weekly_report_{YYYY-MM-DD}.md` |

## 注意

- Ship = 「外部に価値が到達した」もののみ（ドラフト生成 ≠ Ship）
- Learn は wiki に反映されたもののみカウント
- Block は現在進行中のブロッカーのみ
