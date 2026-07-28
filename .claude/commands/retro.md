# retro

週次振り返り（Ship / Learn / Block）をCodex Automation内で完結させるコマンド。

## トリガー

- `/retro`
- ユーザーが「振り返りして」「今週のレトロ」と言及

## 実行原則

- `/ohayo`、`/oyasumi`とは別の週次ワークフローとして実行する。
- 対象期間は前回retro automation実行以降を優先し、前回実行がなければ直近7日間とする。
- 回答とレポートは日本語で作成する。
- 取得不能な入力を0件とみなさず、`未確認`または`pending`として残す。
- 外部送信、公開投稿、削除、不可逆な変更、Learn候補のapply/rejectは明示確認なしに実行しない。
- レポートの正規出力はCodex Automationのタスク本文とautomation memoryとする。Brainbase Wiki、Companion approval inbox、ファイルInboxへ複製しない。

## 実行フロー

### 1. Shipを収集

- NocoDBのcompleted項目、gitのmerge/commit、関連するCodexタスクを対象期間で確認する。
- Shipは「外部または利用者へ価値が到達した」と確認できるものだけを数える。
- local edit、commit、merge、CI、deploy、runtime、外部到達を区別する。

### 2. WorkとBlockを収集

- NocoDBのactive項目、関連するCodexタスク、未完了の実行証跡を確認する。
- Brainbaseの旧session archive、archive finalizer、worktree状態をBlockの入力にしない。
- Blockには現在も結果を妨げているものだけを含め、各項目へ次を付ける。
  - owner
  - next action
  - due
- 入力ソース自体が失敗した場合は、その失敗をBlockまたは未確認sourceとして残す。

### 3. Learn候補をレビュー

```bash
cd /Users/ksato/workspace/code/brainbase
node cli/index.js learn inbox
```

pending候補を一覧し、既存のGraph、owning repository、team Drive、workspace home、skillとの重複を確認する。候補ごとに次を推奨する。

- `graph`: 組織の事実・関係としてGraphへ反映
- `owning_repo`: コード、技術設計、共有ポリシー、runbook、skillとして所有repoへ反映
- `team_drive`: 事業文書、共同編集資料、バイナリとして担当team Driveへ反映
- `workspace_home`: 個人・private情報としてworkspace homeへ反映
- `reject`: ノイズ、既出、粒度不適切
- `hold`: 根拠、所有者、保存先が未確定

現行のLearn CLIが保存先を安全に表現できない場合はapplyせず、推奨と理由だけを残す。

### 4. 公開ライフログ週次点検

対象期間のdaily brief、feedback、content calendar、確認可能な反応証拠を集計する。

- 本人の一次体験ソースから生成されたか、助言・説得・CTAへ変換されていないかを点検する。
- 投稿数や反応値を目標にしない。反応は観測記録として保存し、次週の本文最適化には使わない。
- 一次体験がない日の候補0件は正常とし、入力取得失敗や誤projectionとは分ける。
- 第三者・顧客・家族・健康・秘密情報の誤projectionがあればBlockとして扱う。
- 認証やmetrics取得に失敗した場合は0件扱いせず、未確認sourceに残す。

### 5. 週次レポートを生成

```markdown
# Weekly Retro: YYYY-MM-DD

## 🚀 Ship
- [項目]: [到達した価値と証拠]

## 📚 Learn
- [候補]: [推奨分類 / 理由 / 重複確認]
- 公開ライフログ: [一次体験との一致 / 助言・CTA混入 / privacy / 欠落・誤projection]

## 🔴 Block
- [項目]: [状況 / owner / next action / due]

## ❓ 未確認source
- [source]: [失敗理由 / 影響範囲]

## 📊 メトリクス
- Ship数: X件
- Learn推奨: graph X / owning_repo X / team_drive X / workspace_home X / reject X / hold X
- Block数: X件
```

### 6. Codex Automationへ結果を残す

- 完成した週次レポートをCodex Automationのタスク本文として返す。
- automation memoryへ次を記録する。
  - 実行時刻
  - 対象期間
  - Ship / Learn / Block件数
  - 重要なBlock
  - Learn分類別件数
  - 公開ライフログの一次体験一致件数 / hold理由 / 誤projection
  - 未確認source
- 判断が必要な項目は、選択肢、推奨、影響をそのCodexタスク内に記載する。
- Brainbase WikiへのPOST、`bb-report-submit`、`_inbox/pending.md`への追記は行わない。
