# LambdaTest Mobile Testing Setup

## 概要

LambdaTestを使用して、実機(iPhone/Android)でのモバイルキーボード自動スクロール機能をテストします。

## セットアップ手順

### 1. LambdaTestアカウント作成

1. https://accounts.lambdatest.com/register にアクセス
2. Freeプラン (100分/月) を選択
3. メール認証完了

### 2. 認証情報取得

1. LambdaTest Dashboard → Settings → Access Key
2. `Username` と `Access Key` をコピー

### 3. 環境変数設定

`/Users/ksato/workspace/.env` に以下を追記:

```bash
# LambdaTest
LT_USERNAME="your-username-here"
LT_ACCESS_KEY="your-access-key-here"
```

### 4. テスト実行

```bash
cd /Users/ksato/workspace/projects/brainbase

# すべてのモバイルデバイスでテスト
npm run test:mobile

# iPhone 13 Pro のみ
npm run test:mobile:iphone

# Pixel 7 のみ
npm run test:mobile:android
```

## テスト対象デバイス

| デバイス | OS | ブラウザ |
|---------|-----|---------|
| iPhone 13 Pro | iOS 15 | Safari |
| iPhone 14 | iOS 16 | Safari |
| Pixel 7 | Android 13 | Chrome |

## 確認項目

- ✓ モバイルキーボード表示検知
- ✓ Visual Viewport API 動作
- ✓ postMessage 送信
- ✓ ターミナル自動スクロール

## LambdaTestダッシュボード

テスト結果は以下で確認:
https://automation.lambdatest.com/timeline

- ビデオ録画
- コンソールログ
- ネットワークログ
- スクリーンショット

## トラブルシューティング

### エラー: "Invalid credentials"

```bash
# 環境変数が読み込まれているか確認
source /Users/ksato/workspace/.env
echo $LT_USERNAME
echo $LT_ACCESS_KEY
```

### エラー: "Cannot connect to wsEndpoint"

LambdaTestサービスが利用可能か確認:
https://status.lambdatest.com/

### Freeプラン制限 (100分/月) 超過

- 使用時間確認: https://accounts.lambdatest.com/billing
- 必要に応じてPaidプランへアップグレード ($99/月 無制限)

## CI/CD統合 (GitHub Actions)

`.github/workflows/mobile-e2e.yml`:

```yaml
name: Mobile E2E Tests

on:
  pull_request:
    branches: [main]

jobs:
  lambdatest:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run LambdaTest Mobile Tests
        run: npm run test:mobile
        env:
          LT_USERNAME: ${{ secrets.LT_USERNAME }}
          LT_ACCESS_KEY: ${{ secrets.LT_ACCESS_KEY }}
```

GitHub Secrets設定:
1. Repository → Settings → Secrets → New repository secret
2. `LT_USERNAME` と `LT_ACCESS_KEY` を追加

## 料金プラン

| プラン | 月額 | 時間 | 並列実行 |
|--------|------|------|----------|
| Free | $0 | 100分 | 1 |
| Live | $15 | 600分 | 1 |
| Web Automation | $99 | 無制限 | 5 |

## 参考リンク

- [LambdaTest Documentation](https://www.lambdatest.com/support/docs/)
- [Playwright Integration](https://www.lambdatest.com/support/docs/playwright-with-lambdatest/)
- [Capabilities Generator](https://www.lambdatest.com/capabilities-generator/)
