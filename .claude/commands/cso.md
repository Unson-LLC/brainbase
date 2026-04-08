# cso

月次戦略レビュー（Chief Strategy Officer視点）を実行し、結果を _inbox/pending.md に書き込むコマンド。

## トリガー

- `/cso`
- `/cso --comprehensive`（四半期: 1,4,7,10月）
- ユーザーが「戦略レビューして」「CSOレビュー」と言及

## 実行フロー

### 通常モード（月次）

1. **全プロジェクトのストーリー進捗を収集**
   - NocoDB 全11プロジェクトのストーリーテーブルを集計
   - 各プロジェクトの平均進捗率、active/completed/blocked数

2. **Stop Pattern検知**
   - Ship止まり: completed=0のプロジェクト
   - Work止まり: ブロッカーが2週以上継続
   - Learn止まり: wiki更新がないプロジェクト
   - Decision止まり: draft→activeの遷移がないプロジェクト

3. **戦略レポート生成**
   ```markdown
   # CSO Monthly Review: YYYY-MM

   ## 📊 全体サマリー
   - 全PJ平均進捗率: X%
   - Ship数（月間）: X件
   - Stop Pattern検知: X件

   ## 🏢 プロジェクト別
   | PJ | 進捗率 | Ship | Block | 判定 |
   |----|--------|------|-------|------|
   | ... | X% | X件 | X件 | 🟢/🟡/🔴 |

   ## ⚠️ Stop Pattern
   - [PJ]: [パターン]: [推奨アクション]

   ## 💡 戦略提言
   - [提言1]
   - [提言2]
   ```

4. **_inbox/pending.md に書き込み**
   ```markdown
   ---
   id: INBOX-{timestamp}
   channel: system
   sender: agent/cso
   status: pending
   message: "月次CSOレビュー完了: 全PJ平均進捗率 X%, Stop Pattern X件"
   ---
   ```

### Comprehensiveモード（四半期: `--comprehensive`）

通常モードに加えて:
- Frame適合性チェック（WHO/WHAT/HOW変化）
- Quarter目標達成率
- 次四半期ストーリー策定提案
- リソース再配分提言

## 出力先

| 出力 | パス |
|------|------|
| Inboxエントリ | `_inbox/pending.md` に追記 |
| 詳細レポート | `/tmp/cso/monthly_review_{YYYY-MM}.md` |

## 注意

- 判定基準: 🟢(進捗率50%以上+Ship有), 🟡(30-50%またはBlock有), 🔴(30%未満またはShip=0)
- 戦略提言はStory Driven Development（Value Loop）の観点で生成
