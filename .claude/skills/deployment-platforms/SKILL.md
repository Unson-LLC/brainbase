---
name: deployment-platforms
description: プラットフォーム別デプロイ標準手法ガイド。AWS Lambda・Vercel・Fly.io等の本番デプロイ手順・チェックリスト・トラブルシューティングを参照する際に使用。
tags: [deployment, aws, vercel, flyio, devops, ci-cd]
---

# Deployment Platforms Guide

プラットフォーム別のデプロイ標準手法を定義。本番デプロイ時の手順・チェックリスト・トラブルシューティングを提供。

---

## 対応プラットフォーム

| プラットフォーム | ファイル | 用途 |
|----------------|---------|------|
| **AWS Lambda** | `platforms/aws_lambda.md` | サーバーレス関数デプロイ（Node.js/Python） |
| **Vercel** | `platforms/vercel.md` | Next.js/React等のフロントエンドデプロイ |
| **Fly.io** | `platforms/fly_io.md` | コンテナベースアプリデプロイ |

---

## 使い方

### 1. プラットフォーム判定

プロジェクトの `config.yml` または `.env` からデプロイ先を判定：

```yaml
# config.yml例
deploy:
  platform: "aws-lambda"  # または "vercel", "fly-io"
  environment: "production"
```

### 2. 該当プラットフォームガイド参照

```bash
# AWS Lambda
Read: .claude/skills/deployment-platforms/platforms/aws_lambda.md

# Vercel
Read: .claude/skills/deployment-platforms/platforms/vercel.md

# Fly.io
Read: .claude/skills/deployment-platforms/platforms/fly_io.md
```

### 3. デプロイ実行

各プラットフォームガイドの手順に従ってデプロイ実行。

---

## 共通デプロイチェックリスト

全プラットフォーム共通の事前確認：

- [ ] 全テストがパスしている（`npm test` / `pytest`）
- [ ] セキュリティ検証完了（XSS/CSRF/Input Validation）
- [ ] 環境変数が設定済み（`.env.production` / Secrets Manager）
- [ ] マージ可否判定が `merge_ready: true`
- [ ] ブランチが最新（`git pull origin main`）
- [ ] バージョンタグ付与済み（`git tag v1.2.3`）

---

## Event/Frame/Story 統合

デプロイは **Event(type=ship)** として記録：

```yaml
event:
  type: ship
  timestamp: 2026-02-08T12:00:00Z
  platform: aws-lambda
  version: v1.2.3
  story_id: story-001
  frame_id: frame-q1-2026
  deploy_result: success
  metrics:
    - deployment_time: 45s
    - health_check: pass
```

---

## トラブルシューティング

### デプロイ失敗時の共通対応

1. **ログ確認**
   ```bash
   # AWS Lambda
   aws logs tail /aws/lambda/{function-name} --follow

   # Vercel
   vercel logs {deployment-url}

   # Fly.io
   fly logs
   ```

2. **ロールバック**
   ```bash
   # AWS Lambda（前バージョンに戻す）
   aws lambda update-function-code --function-name {name} --s3-bucket {bucket} --s3-key {previous-version}.zip

   # Vercel（前デプロイに戻す）
   vercel rollback {previous-deployment-url}

   # Fly.io（前バージョンに戻す）
   fly deploy --image {previous-image}
   ```

3. **Event(type=ship)に失敗記録**
   ```yaml
   event:
     type: ship
     result: failed
     error_message: "Deployment failed: ..."
     rollback_executed: true
   ```

---

## 参照例

### devops-specialist W6での使用

```markdown
## W6: デプロイ実行

**Step 1: deployment-platforms Skill参照**
```javascript
Skill({ skill: "deployment-platforms" })
```

**Step 2: プラットフォーム別ガイド読み込み**
```javascript
const platform = config.deploy.platform // "aws-lambda"
Read({ file_path: `.claude/skills/deployment-platforms/platforms/${platform}.md` })
```

**Step 3: デプロイ実行**
（各プラットフォームガイドの手順に従う）

**Step 4: Event(type=ship)記録**
```javascript
// brainbase MCPにEvent記録
createRecords({
  tableName: "events",
  records: [{ type: "ship", platform, version, result: "success" }]
})
```
```

---

## Version

- **Current**: 1.0.0
- **Last Updated**: 2026-02-08
- **Author**: hr-department (devops-specialist強化)

---

## Next Steps

各プラットフォームガイドの詳細は個別ファイル参照：
- `platforms/aws_lambda.md`
- `platforms/vercel.md`
- `platforms/fly_io.md`
