---
name: mana-slack-test
description: mana（Slackボット）のE2Eテスト実行手順。ユーザーとしてメッセージを投稿し、manaの応答を確認する。manaの動作テスト時に使用。
---

# mana Slack E2Eテスト

mana（AIアシスタントSlackボット）の動作テストを実行する手順です。

## 前提条件

以下のトークンがSSM Parameter Storeに保存されている必要があります：

| パラメータ名 | 説明 |
|-------------|------|
| `/mana/slack-user-token` | Slack User Auth Token (xoxp-...) |

Bot TokenはLambda環境変数から取得します。

## テスト実行手順

### 1. トークン取得

```bash
# User Token（SSMから取得）
SLACK_USER_TOKEN=$(aws ssm get-parameter --name "/mana/slack-user-token" --with-decryption --profile k.sato --region us-east-1 --query 'Parameter.Value' --output text)

# Bot Token（Lambda環境変数から取得）
SLACK_BOT_TOKEN=$(aws lambda get-function-configuration --function-name mana --profile k.sato --region us-east-1 --query 'Environment.Variables.SLACK_BOT_TOKEN' --output text)
```

### 2. テストメッセージ投稿

```bash
MANA_BOT_ID="U093QQ0NV5K"
TEST_CHANNEL="C0A2L9FEKEJ"  # 9999-manaテスト

# ユーザーとしてメッセージを投稿
RESPONSE=$(curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_USER_TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{
    \"channel\": \"$TEST_CHANNEL\",
    \"text\": \"<@$MANA_BOT_ID> <テストメッセージ>\"
  }")

TS=$(echo "$RESPONSE" | jq -r '.ts')
echo "Posted: $TS"
```

### 3. mana応答待ち＆確認

```bash
# 15-20秒待機
sleep 15

# スレッドの返信を取得
curl -s -X GET "https://slack.com/api/conversations.replies?channel=$TEST_CHANNEL&ts=$TS" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" | jq '.messages[1].text'
```

## テストシナリオ例

### タスク追加テスト

```bash
# @mana @担当者 の形式でタスク追加
SATO_USER_ID="U07LNUP582X"

curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_USER_TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{
    \"channel\": \"$TEST_CHANNEL\",
    \"text\": \"<@$MANA_BOT_ID> <@$SATO_USER_ID> タスク追加テスト。〇〇を金曜日までに仕上げる\"
  }"
```

期待される結果：
- タスク1件として登録される
- 期限が適切な日付（金曜日）に設定される

### 質問応答テスト

```bash
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_USER_TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{
    \"channel\": \"$TEST_CHANNEL\",
    \"text\": \"<@$MANA_BOT_ID> 今日の予定を教えて\"
  }"
```

## CloudWatchログ確認

```bash
# 直近5分のログを確認
START_TIME=$(python3 -c "import time; print(int((time.time() - 300) * 1000))")

aws logs filter-log-events \
  --log-group-name "/aws/lambda/mana" \
  --start-time "$START_TIME" \
  --profile k.sato \
  --region us-east-1 \
  --no-cli-pager | grep -E "task|Task|error|Error" | head -20
```

## トラブルシューティング

### User Tokenが期限切れの場合

1. Slack App管理画面でトークンを再生成
2. SSMパラメータを更新：

```bash
aws ssm put-parameter \
  --name "/mana/slack-user-token" \
  --value "xoxp-新しいトークン" \
  --type SecureString \
  --overwrite \
  --profile k.sato \
  --region us-east-1
```

### manaが応答しない場合

1. CloudWatchログを確認
2. Lambda関数のステータスを確認
3. デプロイが必要な場合：`cd /Users/ksato/workspace/mana && bash deploy.sh`

## 関連リソース

| リソース | 値 |
|---------|-----|
| Lambda関数名 | mana |
| テストチャンネル | C0A2L9FEKEJ (9999-manaテスト) |
| mana Bot ID | U093QQ0NV5K |
| 佐藤 User ID | U07LNUP582X |
| AWS Region | us-east-1 |
| AWS Profile | k.sato |
