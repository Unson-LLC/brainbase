# Vercel デプロイ標準手法

Next.js/React/Vue等のフロントエンドアプリケーションのVercelへのデプロイ手順。

---

## 前提条件

- [ ] Vercel CLI インストール済み（`vercel --version`）
- [ ] Vercel認証設定済み（`vercel login`）
- [ ] プロジェクトがVercelにリンク済み（`vercel link`）
- [ ] ビルド設定確認済み（`vercel.json` または設定ダッシュボード）

---

## デプロイ手順

### Step 1: ローカルビルド確認

```bash
# Next.js例
npm run build
npm run start  # 動作確認

# Vite/React例
npm run build
npm run preview  # 動作確認
```

### Step 2: 環境変数設定

```bash
# Vercel環境変数追加
vercel env add NEXT_PUBLIC_API_URL production
# 値を入力: https://api.example.com

# または .env.production から一括設定
vercel env pull .env.production
```

### Step 3: プレビューデプロイ（本番前確認）

```bash
# プレビュー環境へデプロイ
vercel

# デプロイURLが表示される
# https://{project-name}-{random-hash}.vercel.app
```

### Step 4: 本番デプロイ

```bash
# 本番環境へデプロイ
vercel --prod

# カスタムドメインが設定済みの場合
# https://example.com へ自動デプロイ
```

### Step 5: デプロイ検証

```bash
# デプロイ状態確認
vercel ls

# ログ確認
vercel logs {deployment-url}

# ドメイン確認
vercel domains ls
```

---

## vercel.json 設定例

```json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "@vercel/next"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/$1"
    }
  ],
  "env": {
    "NEXT_PUBLIC_API_URL": "@api-url-production"
  }
}
```

---

## GitHub連携デプロイ（推奨）

### 初回設定

1. Vercel ダッシュボードでGitHub連携
2. リポジトリ選択
3. ブランチ設定（`main` → Production、`develop` → Preview）

### 自動デプロイフロー

```
git push origin main
  ↓
Vercel自動検知
  ↓
ビルド実行
  ↓
本番デプロイ
  ↓
デプロイ完了通知（Slack/Email）
```

---

## デプロイチェックリスト

- [ ] ビルド成功（`npm run build`）
- [ ] 環境変数設定済み（`vercel env ls production`）
- [ ] プレビューデプロイで動作確認済み
- [ ] カスタムドメイン設定済み（必要な場合）
- [ ] SSL証明書有効（Vercel自動発行）
- [ ] Analyticsタグ設定済み（必要な場合）
- [ ] エラートラッキング設定済み（Sentry等）

---

## トラブルシューティング

### エラー: "Build failed"

**原因**: ビルドスクリプトエラー、依存関係不足

**対処**:
```bash
# ローカルで再現確認
npm run build

# ログ確認
vercel logs {deployment-url}

# Node.jsバージョン確認（vercel.json）
{
  "builds": [{
    "src": "package.json",
    "use": "@vercel/next",
    "config": { "nodeVersion": "18.x" }
  }]
}
```

### エラー: "Environment variable not found"

**原因**: 環境変数が設定されていない

**対処**:
```bash
# 環境変数一覧確認
vercel env ls

# 追加
vercel env add {VAR_NAME} production
```

### エラー: "Deployment exceeded time limit"

**原因**: ビルド時間が制限（Hobbyプラン: 45秒、Proプラン: 15分）を超過

**対処**:
```bash
# ビルドキャッシュ活用
# vercel.json
{
  "builds": [{
    "src": "package.json",
    "use": "@vercel/next",
    "config": { "maxDuration": 60 }
  }]
}

# または依存関係を最小化
npm prune --production
```

---

## ロールバック

```bash
# デプロイ履歴確認
vercel ls

# 特定のデプロイへロールバック
vercel rollback {previous-deployment-url}

# または alias変更
vercel alias {previous-deployment-url} example.com
```

---

## Event(type=ship)記録例

```yaml
event:
  type: ship
  timestamp: 2026-02-08T12:00:00Z
  platform: vercel
  project_name: my-nextjs-app
  version: v1.2.3
  deployment_url: https://my-nextjs-app.vercel.app
  deployment_time: 32s
  build_time: 28s
  result: success
  metrics:
    - lighthouse_performance: 98
    - lighthouse_accessibility: 100
    - lighthouse_seo: 95
    - bundle_size: 245KB
```

---

## パフォーマンス最適化

### 画像最適化

```javascript
// Next.js Image component使用
import Image from 'next/image'

<Image
  src="/image.jpg"
  width={500}
  height={300}
  alt="Description"
/>
```

### Edge Functions活用

```javascript
// pages/api/edge-function.js
export const config = {
  runtime: 'edge',
}

export default function handler(req) {
  return new Response('Hello from Edge')
}
```

---

## 参考リンク

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel CLI Reference](https://vercel.com/docs/cli)
- [Next.js on Vercel](https://vercel.com/docs/frameworks/nextjs)

---

**Last Updated**: 2026-02-08
