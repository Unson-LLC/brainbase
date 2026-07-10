# フェーズ4: 必要な情報源

最初の価値を試して足りなかった情報だけを追加します。Brainbaseが外部サービスへ直接ログインするのではなく、CodexやClaude Codeが利用できる収集手段やエクスポートを使います。

## 利用中の道具を確認する

AIは次をヒアリングします。

- メール: Gmail、Google Workspace、Outlookなど
- カレンダー: Google Calendar、Outlook Calendarなど
- ファイル: Google Drive、Dropbox、OneDrive、ローカルフォルダなど
- タスク: GitHub Issues、Notion、Linear、Todoist、スプレッドシートなど
- 会議記録: Omi、Fieldy、文字起こし、手書きメモなど

接続前に、対象プロジェクト、アカウント、フォルダ、期間を決めます。全履歴を無条件に読む設定にはしません。

## 対応範囲

Brainbase v1が取り込める形式は次の4つです。

| 入力 | 方法 |
| --- | --- |
| Gmail | gogなどで収集したJSONを `gmail` として取り込む |
| Google Calendar | gogなどで収集したJSONを `calendar` として取り込む |
| Google Drive | gogなどで収集したJSONを `drive` として取り込む |
| ローカル資料 | エクスポートしたJSONを `local` として取り込む |

タスク管理サービス、Omi、Fieldyへの直接接続はv1にはありません。安全にエクスポートできる場合は、必要な項目だけをローカル資料として扱います。音声や会議記録は、先にプロジェクト、関係者、固有名詞を登録してから使うと、AIが文脈を合わせやすくなります。

## 接続方法を診断する

Google Workspaceを使う例です。

```bash
node dist/cli.js onboard:diagnose-sources \
  --email gmail \
  --calendar google-calendar \
  --drive google-drive \
  --drive-folder "対象フォルダID" \
  --tasks notion
```

このコマンドは準備状況と推奨手順を確認するだけで、GoogleやNotionへログインしません。

## 取り込みから正本まで

外部ツールで収集したJSONを、種類ごとに取り込みます。

```bash
node dist/cli.js onboard:import --source gmail --from /tmp/gmail.json
node dist/cli.js onboard:import --source calendar --from /tmp/calendar.json
node dist/cli.js onboard:import --source drive --from /tmp/drive.json
node dist/cli.js onboard:import --source local --from /tmp/meeting-notes.json
```

通常は、本文を丸ごと保存せず、送受信者、日時、件名、ファイル名などの最小情報を優先します。

次に、今後も使う可能性がある人物、組織、プロジェクト、関係性、次の行動を確認用に整理します。

```bash
node dist/cli.js onboard:extract --self-email "自分のメールアドレス" --write
```

確認結果は内部的に `candidates/` フォルダへ保存されます。これは正本ではなく、人が確認するための下書き置き場です。承認した項目だけを選び、まずdry-runで確認します。

```bash
node dist/cli.js onboard:apply --from "確認結果のJSON" --select "項目ID"
```

内容が正しければ `--write` を加えます。これ以外の項目は正本へ入りません。

## 個人の気づきと仕事の正本を分ける

経験、違和感、判断の癖、まだ仕事で使うか迷う考えはPersonal KGへ置きます。人物、プロジェクト、関係性、決定事項として今後も使うと承認した情報だけを仕事の正本へ入れます。

## 安全ルール

- OAuthトークン、パスワード、APIキーをチャットに貼らない
- ユーザーが許可したアカウント、フォルダ、期間だけを収集する
- 外部サービスから読めたことと、正本へ書いてよいことを分ける
- `onboard:import` と `onboard:extract` は正本を書き換えない
- 正本への書き込みは、選択した項目に対する `onboard:apply --write` だけで行う

必要な情報を確認できたら、[フェーズ5: 運用開始](/guide/operations)へ進みます。
