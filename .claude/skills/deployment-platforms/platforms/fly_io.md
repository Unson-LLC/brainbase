# Fly.io デプロイ標準手法

コンテナベースアプリケーション（Docker）のFly.ioへのデプロイ手順。

---

## 前提条件

- [ ] Fly CLI インストール済み（`fly version`）
- [ ] Fly.io認証設定済み（`fly auth login`）
- [ ] Dockerfileが作成済み
- [ ] fly.toml設定ファイルが作成済み（または `fly launch` で生成）

---

## デプロイ手順

### Step 1: アプリ初期化（初回のみ）

```bash
# Fly.ioアプリ作成
fly launch

# 対話形式で設定
# - App name: my-app
# - Region: nrt (Tokyo)
# - Postgresql database: No (必要な場合は Yes)
# - Redis: No (必要な場合は Yes)
```

### Step 2: fly.toml 確認・編集

```toml
# fly.toml
app = "my-app"
primary_region = "nrt"  # Tokyo

[build]
  dockerfile = "Dockerfile"

[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

[env]
  NODE_ENV = "production"
```

### Step 3: 環境変数設定

```bash
# シークレット設定
fly secrets set DATABASE_URL="postgres://..."

# 環境変数一覧確認
fly secrets list
```

### Step 4: デプロイ実行

```bash
# 本番デプロイ
fly deploy

# ビルドログ確認しながらデプロイ
fly deploy --verbose
```

### Step 5: デプロイ検証

```bash
# アプリ状態確認
fly status

# ログ確認
fly logs

# アプリを開く
fly open

# ヘルスチェック
curl https://my-app.fly.dev/health
```

---

## Dockerfile例

### Node.js（Express）

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
```

### Python（FastAPI）

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

---

## スケーリング

### 水平スケーリング（インスタンス数）

```bash
# インスタンス数を3に増やす
fly scale count 3

# オートスケーリング設定
fly autoscale set min=1 max=5
```

### 垂直スケーリング（リソース）

```bash
# VMサイズ変更
fly scale vm shared-cpu-1x  # 256MB RAM
fly scale vm shared-cpu-2x  # 512MB RAM
fly scale vm performance-1x  # 2GB RAM
```

---

## デプロイチェックリスト

- [ ] Dockerfile最適化済み（Multi-stageビルド、レイヤーキャッシュ）
- [ ] fly.toml設定確認済み（port, region, env）
- [ ] 環境変数/シークレット設定済み
- [ ] ヘルスチェックエンドポイント実装済み（`/health`）
- [ ] ログ出力設定済み（stdout/stderr）
- [ ] データベース接続確認済み（Fly Postgres使用時）
- [ ] カスタムドメイン設定済み（必要な場合）
- [ ] SSL証明書有効（Fly.io自動発行）

---

## トラブルシューティング

### エラー: "Failed to build Docker image"

**原因**: Dockerfileエラー、依存関係不足

**対処**:
```bash
# ローカルでDockerビルド確認
docker build -t my-app .
docker run -p 8080:8080 my-app

# ログ確認
fly logs --verbose
```

### エラー: "Health check failed"

**原因**: ヘルスチェックエンドポイントが応答しない

**対処**:
```bash
# fly.tomlにヘルスチェック設定
[[services.http_checks]]
  interval = "10s"
  grace_period = "5s"
  method = "GET"
  path = "/health"
  protocol = "http"
  timeout = "2s"
```

```javascript
// ヘルスチェックエンドポイント実装例（Express）
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' })
})
```

### エラー: "Out of memory"

**原因**: VMメモリ不足

**対処**:
```bash
# VMサイズアップ
fly scale vm shared-cpu-2x  # 512MB
fly scale vm performance-1x  # 2GB

# メモリ使用量確認
fly vm status
```

---

## データベース運用（Fly Postgres）

### Postgresデータベース作成

```bash
# Postgresクラスタ作成
fly postgres create

# データベース接続情報確認
fly postgres connect -a {postgres-app-name}

# アプリにアタッチ
fly postgres attach {postgres-app-name}
```

### マイグレーション実行

```bash
# SSH接続してマイグレーション実行
fly ssh console

# コンテナ内でマイグレーション
cd /app
npm run migrate
```

---

## ロールバック

```bash
# デプロイ履歴確認
fly releases

# 前バージョンにロールバック
fly releases rollback {version-number}

# 例: v3にロールバック
fly releases rollback 3
```

---

## Event(type=ship)記録例

```yaml
event:
  type: ship
  timestamp: 2026-02-08T12:00:00Z
  platform: fly-io
  app_name: my-app
  version: v1.2.3
  region: nrt
  deployment_time: 120s
  build_time: 90s
  docker_image_size: 156MB
  result: success
  metrics:
    - instances: 2
    - vm_size: shared-cpu-1x
    - memory_used: 180MB
    - health_check: pass
```

---

## コスト最適化

### 無料枠活用

```bash
# Fly.io無料枠（Hobby Plan）
# - VM: shared-cpu-1x × 3インスタンス
# - ボリューム: 3GB
# - トラフィック: 160GB/月
```

### 不要リソース削除

```bash
# 使用中のアプリ一覧
fly apps list

# アプリ削除
fly apps destroy {app-name}

# ボリューム削除
fly volumes destroy {volume-id}
```

---

## モニタリング

```bash
# リアルタイムログ
fly logs --verbose

# メトリクス確認
fly vm status

# SSH接続（デバッグ時）
fly ssh console
```

---

## 参考リンク

- [Fly.io Documentation](https://fly.io/docs/)
- [Fly CLI Command Reference](https://fly.io/docs/flyctl/)
- [Dockerfile Best Practices](https://docs.docker.com/develop/dev-best-practices/)

---

**Last Updated**: 2026-02-08
