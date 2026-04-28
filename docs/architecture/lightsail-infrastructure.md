# Lightsail サーバ構成図

## 概要

brainbaseプラットフォームの本番バックエンドは AWS Lightsail インスタンス1台で構成。
Docker Compose で複数サービスを運用。

- **インスタンス**: brainbase-nocodb (AWS ap-northeast-1)
- **パブリックIP**: 176.34.20.239
- **OS**: Ubuntu 22.04 LTS
- **スペック**: 4GB RAM, 2 vCPU, 80GB SSD
- **SSH**: `ssh -i ~/.ssh/lightsail-brainbase.pem ubuntu@176.34.20.239`

## ネットワーク構成

```
Internet
  │
  ├── :443 (HTTPS) ─── nginx-proxy ─── Let's Encrypt SSL
  │                       │
  │    bb.unson.jp ───────┼── brainbase-ssot-proxy (:80)
  │                       │        └── host.docker.internal:55123
  │                       │              └── brainbase server (Node.js)
  │                       │                    └── System PostgreSQL 14 (:5432)
  │                       │                          └── DB: brainbase_ssot
  │                       │
  │    noco.unson.jp ─────┼── NocoDB (:8080)
  │                       │     └── Docker PostgreSQL 15 (:5432)
  │                       │           └── DB: nocodb
  │                       │
  │    graph.brain-base.work ── Graph API (:3000)
  │                                └── System PostgreSQL 14 (:5432)
  │                                      └── DB: brainbase_ssot
  │
  │    infisical.unson.jp ─── Infisical (:8080)
  │                              ├── Docker PostgreSQL 14 (:5432, internal)
  │                              └── Redis 7 (:6379, internal)
  │
  └── :22 (SSH)
```

## Docker コンテナ一覧

### docker-compose.yml (メイン: /home/ubuntu/)

| コンテナ | イメージ | ポート | 用途 |
|---|---|---|---|
| **nginx-proxy** | nginxproxy/nginx-proxy | 0.0.0.0:80, :443 | リバースプロキシ + SSL終端 |
| **letsencrypt** | nginxproxy/acme-companion | - | SSL証明書自動更新 |
| **brainbase-ssot-proxy** | nginx:alpine | (内部:80) | bb.unson.jp → host:55123 プロキシ |
| **nocodb** | nocodb/nocodb | (内部:8080) | NocoDB (タスク/プロジェクト管理) |
| **postgres** | postgres:15 | (内部:5432) | NocoDB用PostgreSQL |

**ネットワーク**: `ubuntu_nocodb-network` (bridge)

### docker-compose.graph-api.yml (/home/ubuntu/brainbase/)

| コンテナ | イメージ | ポート | 用途 |
|---|---|---|---|
| **brainbase-graph-api** | brainbase-graph-api:latest | (内部:3000) | Graph API (エンティティ/関係性) |

**ネットワーク**: `ubuntu_nocodb-network` (external) — nginx-proxyと共有

### docker-compose.yml (Honcho: /home/ubuntu/honcho/)

| コンテナ | イメージ | ポート | 用途 |
|---|---|---|---|
| **honcho-api** | honcho-api (build) | 127.0.0.1:8100 | Honcho Memory API |
| **honcho-deriver** | honcho-deriver (build) | - | バックグラウンド推論ワーカー |
| **honcho-database** | pgvector/pgvector:pg15 | 127.0.0.1:5433 | Honcho用PostgreSQL (pgvector) |
| **honcho-redis** | redis:8.2 | 127.0.0.1:6379 | キャッシュ/キュー |

**ネットワーク**: `honcho_default` (独立)

### docker-compose.yml (Infisical: /opt/infisical/)

| コンテナ | イメージ | ポート | 用途 |
|---|---|---|---|
| **infisical-backend** | infisical/infisical@sha256:c573... | (内部:8080) | Secret management UI/API |
| **infisical-db** | postgres:14-alpine | (内部:5432) | Infisical用PostgreSQL |
| **infisical-redis** | redis:7-alpine | (内部:6379) | Infisical cache/queue |

**ネットワーク**: `infisical_infisical-internal` (独立) + `ubuntu_nocodb-network` (nginx-proxy共有)

## ホストプロセス（Docker外）

| プロセス | ポート | 用途 |
|---|---|---|
| **brainbase server** (Node.js) | :55123 | brainbase SSOT サーバ（メイン） |
| **PostgreSQL 14** (system) | :5432 | brainbase_ssot データベース |

## データベース構成

```
System PostgreSQL 14 (localhost:5432)
  ├── brainbase_ssot   ← brainbase server + Graph API が使用
  └── user: brainbase_app

Docker PostgreSQL 15 - NocoDB (nocodb-network内 :5432)
  ├── nocodb           ← NocoDB が使用
  └── user: nocodb

Docker PostgreSQL 15 - Honcho (honcho_default内 :5432, host :5433)
  ├── honcho           ← Honcho API/Deriver が使用
  └── user: honcho     ← pgvector 拡張あり

Docker PostgreSQL 14 - Infisical (infisical-internal内 :5432)
  ├── infisical        ← Infisical が使用
  └── user: infisical
```

## ドメイン・DNS・SSL 構成

### DNS レコード

| ドメイン | IPアドレス | DNSプロバイダ | レコードタイプ |
|---|---|---|---|
### Lightsailに向くレコード

| ドメイン | IP | タイプ | DNS管理 |
|---|---|---|---|
| **bb.unson.jp** | 176.34.20.239 | A | Route53 (unson.jp) |
| **noco.unson.jp** | 176.34.20.239 | A | Route53 (unson.jp) |
| **infisical.unson.jp** | 176.34.20.239 | A | Route53 (unson.jp) |
| **graph.brain-base.work** | 176.34.20.239 | A | Cloudflare (brain-base.work) |

### DNSゾーン一覧

| ドメイン | 管理場所 | Route53 Zone ID |
|---|---|---|
| **unson.jp** | AWS Route53 | Z0906877KZJ9LFTXF6QS |
| **tech-knight.jp** | AWS Route53 | Z08485133BLE8H4ACJ8JY |
| **flux-system.com** | AWS Route53 | Z02239413FYMYZNU3KMUN |
| **brain-base.work** | Cloudflare | (Cloudflare Dashboard) |

### unson.jp 全サブドメイン（Route53）

| サブドメイン | 向き先 | 用途 |
|---|---|---|
| `bb.unson.jp` | **176.34.20.239** (Lightsail) | brainbase SSOT API |
| `noco.unson.jp` | **176.34.20.239** (Lightsail) | NocoDB |
| `infisical.unson.jp` | **176.34.20.239** (Lightsail) | Infisical |
| `unson.jp` | 76.76.21.21 (Vercel) | コーポレートサイト |
| `www.unson.jp` | Vercel | コーポレートサイト |
| `os.unson.jp` | Vercel | Unson OS (brainbase UI) |
| `dialogai.unson.jp` | CloudFront | DialogAI |
| `mywa.unson.jp` | Vercel | Mywa |
| `lp-mywa.unson.jp` | Vercel | Mywa LP |
| `ai-bridge.unson.jp` | Vercel | AI Bridge |
| `ai-coach.unson.jp` | Vercel | AI Coach |
| `ai-legacy.unson.jp` | Vercel | AI Legacy |
| `ai-stylist.unson.jp` | Vercel | AI Stylist |
| `detective-ai.unson.jp` | Vercel | Detective AI |
| `eventsync.unson.jp` | Vercel | EventSync |
| `postio.unson.jp` | Vercel | Postio |
| `sentry.unson.jp` | 52.68.79.93 | Sentry |
| `zep.unson.jp` | 54.64.151.167 | Zep (廃止予定) |

### brain-base.work サブドメイン（Cloudflare）

| サブドメイン | 向き先 | 用途 |
|---|---|---|
| `graph.brain-base.work` | **176.34.20.239** (Lightsail) | Graph API |

### SSL 証明書

Let's Encrypt で自動取得・更新。nginx-proxy + acme-companion が管理。

| ドメイン | 証明書 | 自動更新 |
|---|---|---|
| bb.unson.jp | ✅ あり | ✅ acme-companion |
| noco.unson.jp | ✅ あり | ✅ acme-companion |
| infisical.unson.jp | ✅ あり | ✅ acme-companion |
| graph.brain-base.work | Cloudflare側で終端 | Cloudflare Proxy (orange cloud) でSSL。Lightsail側はHTTPで受ける |

### nginx-proxy ルーティング（自動生成）

nginx-proxy は Docker の `VIRTUAL_HOST` 環境変数を検知して自動設定する。

```
HTTPS :443
  │
  ├── Host: bb.unson.jp
  │     └── upstream: brainbase-ssot-proxy:80
  │           └── proxy_pass → host.docker.internal:55123 (brainbase server)
  │
  ├── Host: noco.unson.jp
  │     └── upstream: nocodb:8080
  │
  ├── Host: infisical.unson.jp
  │     └── upstream: infisical-backend:8080
  │
  └── Host: graph.brain-base.work
        └── upstream: brainbase-graph-api:3000
```

**仕組み**: `VIRTUAL_HOST=bb.unson.jp` をコンテナの環境変数に設定すると、nginx-proxy が自動でupstream/server_nameを生成。`LETSENCRYPT_HOST` を設定するとacme-companionがSSL証明書を自動取得。

### 新規ドメイン追加手順

1. Route53 で `xxx.unson.jp` → `176.34.20.239` のAレコードを追加（Zone ID: Z0906877KZJ9LFTXF6QS）
2. Dockerコンテナに `VIRTUAL_HOST=xxx.unson.jp` `LETSENCRYPT_HOST=xxx.unson.jp` を設定
3. nginx-proxy が自動検知してルーティング + SSL証明書を取得

**または** 既存ドメインのパスベースルーティング（例: `bb.unson.jp/honcho/`）の場合:
1. `brainbase-ssot.nginx.conf` に `location /honcho/` ブロックを追加
2. nginx-proxy を再起動

## 外部からのアクセスパターン

```
mana Lambda (us-east-1)
  ├── https://bb.unson.jp          → Graph API (プロジェクトコンテキスト)
  ├── https://noco.unson.jp        → NocoDB API (タスク/スプリント)
  └── http://176.34.20.239:8100    → Honcho API (エージェントメモリ) ※要nginx経由に変更

brainbase UI (ローカルMac / Cloudflare Tunnel)
  └── https://bb.unson.jp          → brainbase server (全機能)
```

## リソース使用量 (2026-04時点)

| リソース | 使用量 | 上限 | 備考 |
|---|---|---|---|
| **メモリ** | ~1.8GB | 4GB | Honcho追加後。余裕あり |
| **ディスク** | ~19GB | 80GB | Docker images含む |
| **CPU** | 低負荷 | 2 vCPU | ピーク時でも50%以下 |

## 運用コマンド

```bash
# SSH接続
ssh -i ~/.ssh/lightsail-brainbase.pem ubuntu@176.34.20.239

# メインサービス管理
cd /home/ubuntu && docker compose ps
cd /home/ubuntu && docker compose restart [service]

# Graph API管理
cd /home/ubuntu/brainbase && docker compose -f docker-compose.graph-api.yml ps

# Honcho管理
cd /home/ubuntu/honcho && docker compose ps
cd /home/ubuntu/honcho && docker compose logs -f api

# Infisical管理
cd /opt/infisical && docker compose -p infisical ps
cd /opt/infisical && docker compose -p infisical logs -f backend

# brainbase server (ホストプロセス)
ps aux | grep "node.*server.js"
# 再起動は systemd ではなく手動 (TODO: systemd化)

# PostgreSQL (System)
PGPASSWORD='<Infisicalまたは運用secret storeから取得>' psql -h localhost -U brainbase_app -d brainbase_ssot

# ログ確認
docker logs nginx-proxy --tail 20
docker logs brainbase-graph-api --tail 20
docker logs honcho-api --tail 20
docker logs infisical-backend --tail 20
```
