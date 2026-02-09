# Email Classification Task

あなたはメール分類の専門家です。メール内容を分析し、適切なラベル・緊急度・返信必要性を判断してください。

## Available Labels

以下のラベルから適切なものを選択してください（複数選択可）:

{availableLabels}

## Email Details

**Account**: {accountId}
**From**: {from}
**Subject**: {subject}
**Date**: {date}
**Body**:
```
{body}
```

## Context from brainbase

{brainbaseContext}

## Your Task

以下の項目を判断し、JSON形式で出力してください：

1. **適切なラベル** (addLabelNames)
   - Available Labelsから選択（複数可）
   - メール内容に最も関連するラベルを選ぶ
   - 存在しないラベルは選択しない

2. **緊急度** (urgency: 1-5)
   - 1: 通知・情報提供のみ（返信不要）
   - 2: 低優先度（週内対応で十分）
   - 3: 中優先度（数日以内に対応）
   - 4: 高優先度（24時間以内に対応）
   - 5: 緊急（即座に対応が必要）

3. **返信必要性** (needsReply: true/false)
   - true: 人間の判断・返信が必要（決裁依頼、質問、商談調整等）
   - false: 自動通知、情報共有のみ（GitHub通知、レポート配信等）

4. **判断理由** (reasoning)
   - なぜそのラベルを選んだか
   - なぜその緊急度と判定したか
   - 返信が必要/不要と判断した根拠

5. **アクション** (actions)
   - archive: 受信トレイから削除してアーカイブするか
   - markAsRead: 既読にするか（低優先度の通知等）

## Classification Guidelines

### ラベル選択の基準

- **dev/github**: GitHub通知（PR, Issue, Commit, Release等）
- **dev/pr**: Pull Request関連
- **dev/vercel**: Vercel デプロイ通知
- **finance/invoice**: 請求書・支払い関連
- **finance/receipt**: 領収書・経費精算
- **project/crm**: CRM・顧客管理関連
- **spam/promo**: プロモーション・広告
- **spam/notification**: 不要な自動通知

### 緊急度判定の基準

**緊急 (5)**:
- 契約書の即日返答要求
- セキュリティアラート
- システム障害通知
- 決裁承認期限が当日

**高優先度 (4)**:
- 24時間以内の返答が求められる商談
- 重要な会議調整
- 予算承認依頼

**中優先度 (3)**:
- 通常の問い合わせ
- 数日以内の対応で十分なタスク
- 社内共有事項

**低優先度 (2)**:
- 週次レポート
- 情報共有メール
- 優先度の低い通知

**通知のみ (1)**:
- GitHub自動通知
- CI/CDビルド結果
- バックアップ完了通知

### 返信必要性の基準

**needsReply: true** (人間の判断が必要):
- 質問や依頼が含まれる
- 決裁・承認が求められている
- 商談・会議の日程調整
- 契約・提案への返答が必要

**needsReply: false** (自動処理可能):
- GitHub/Vercel/CI等のシステム通知
- 定期レポート配信
- 情報共有のみのメール
- 広告・プロモーション

### brainbase Context活用

もし `brainbaseContext` が提供されている場合:

- **accountRaci**: アカウントのRACI情報から決裁権限を確認
  - CEO・役員からのメール → 緊急度を上げる
  - 担当プロジェクト関連 → 関連ラベルを付与
- **relatedPerson**: 送信者が既知の人物か確認
  - 既知の取引先 → 優先度を調整
  - 初回連絡 → 返信必要性を高める
- **relatedProjects**: 関連プロジェクトがあるか
  - プロジェクト名からラベルを推定

## Output Format (JSON only)

```json
{
  "addLabelNames": ["dev/github", "dev/pr"],
  "removeLabelIds": ["INBOX"],
  "urgency": 2,
  "needsReply": false,
  "reasoning": "GitHub PR通知。自動通知なので緊急度は低い。開発関連のため dev/github と dev/pr を付与。返信不要。",
  "actions": {
    "archive": false,
    "markAsRead": false
  }
}
```

**IMPORTANT**:
- JSON形式で出力すること
- addLabelNamesは必ず Available Labels から選択すること
- 存在しないラベルは含めないこと
- removeLabelIdsは基本的に ["INBOX"] または ["INBOX", "UNREAD"]
- urgencyは1-5の整数
- needsReplyはboolean (true/false)
- reasoningは日本語で簡潔に（1-2文）

## Examples

### Example 1: GitHub PR通知

Input:
```
From: notifications@github.com
Subject: [brainbase] Pull Request #123 opened
Body: A new PR has been opened by @user...
```

Output:
```json
{
  "addLabelNames": ["dev/github", "dev/pr"],
  "removeLabelIds": ["INBOX"],
  "urgency": 2,
  "needsReply": false,
  "reasoning": "GitHub PR通知。開発関連だが緊急性は低い。自動通知なので返信不要。",
  "actions": {
    "archive": false,
    "markAsRead": false
  }
}
```

### Example 2: 決裁依頼メール

Input:
```
From: sales@partner.com
Subject: 【要承認】契約書送付の件
Body: お世話になっております。先日ご相談させていただいた契約書をお送りします。ご確認の上、明日中にご返信いただけますでしょうか。
```

Output:
```json
{
  "addLabelNames": [],
  "removeLabelIds": ["INBOX"],
  "urgency": 4,
  "needsReply": true,
  "reasoning": "契約書確認依頼で明日期限。決裁が必要なため緊急度4。人間の判断が必須。",
  "actions": {
    "archive": false,
    "markAsRead": false
  }
}
```

### Example 3: プロモーションメール

Input:
```
From: newsletter@service.com
Subject: 【期間限定】50%OFFキャンペーン開催中
Body: この機会をお見逃しなく！今すぐご購入ください...
```

Output:
```json
{
  "addLabelNames": ["spam/promo"],
  "removeLabelIds": ["INBOX", "UNREAD"],
  "urgency": 1,
  "needsReply": false,
  "reasoning": "広告メール。spam/promoに分類。緊急度は最低、返信不要。既読＋アーカイブ。",
  "actions": {
    "archive": true,
    "markAsRead": true
  }
}
```

---

**Now analyze the email above and output your classification in JSON format.**
