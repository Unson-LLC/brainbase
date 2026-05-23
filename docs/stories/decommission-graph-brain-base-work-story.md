---
story_id: decommission-graph-brain-base-work
title: graph.brain-base.work ルートを廃止し Infisical 経由で bb.unson.jp に統一する
source:
  type: maintenance
  origin: conversation
  url: N/A
  date: 2026-05-21
architecture_docs:
  - path: docs/architecture/lightsail-infrastructure.md
    status: updated
    reason: 構成図から graph.brain-base.work 行を削除し、bb.unson.jp 単一の経路に整える
  - path: N/A (ADR)
    status: not_required
    reason: 既存サービスの撤去とデフォルト URL 変更のみで、新規アーキテクチャ判断ではない
related_tasks: []
status: in_progress
---

# graph.brain-base.work ルートを廃止し Infisical 経由で bb.unson.jp に統一する

## 背景

直近7日の Claude Code / Codex セッションで「Graph SSOT に引きに行っても結果が出ない」事象を監査した結果、以下が判明した。

- MCP `mcp__brainbase__list_entities` が常に 0 件を返していた
- 原因は `mcp/brainbase/src/config.ts` の `DEFAULT_GRAPH_API_URL = 'https://graph.brain-base.work'` と `.mcp.json` / `~/.codex/config.toml` が同 URL を指していたこと
- `graph.brain-base.work` はインスタンス `brainbase-nocodb` (176.34.20.239) を指しているが、nginx-proxy に server block が存在せず TLS handshake が "unrecognized name" で即死していた
- 同じ Graph データは `https://bb.unson.jp/api/info/graph/entities` から正常に取得可能 (person 54 / org 19 / customer 9 / decision 124 等)

`graph.brain-base.work` は OSS 化準備の文脈 (2026-03-30 周辺、`feat(graph-api): Add Lightsail deployment configuration` 等) で、UI を排除した API 専用エンドポイントを公開する目的で分離された。しかし OSS 公開時は別サーバを立てる方針となり、本ホストをそのまま外部公開する想定は無くなった。デッドルートとして残ると、agent が `mcp__brainbase__*` を叩いて空振り → Graph 不在と誤判定 → 推測に逃げる連鎖が起きる。

## 方針

`bb.unson.jp` を単一の正本 URL とし、`graph.brain-base.work` の設定・コンテナ・DNS を全廃する。MCP の env は Infisical 経由で配るパターン (`run-slack-mcp.sh` 準拠) に揃え、`.mcp.json` / `~/.codex/config.toml` から URL の直書きを排除する。

Infisical (`https://infisical.unson.jp` 上の project `ce20541c-02b9-4523-bbe0-49d50b2fcc19`, env `prod`) には既に `BRAINBASE_API_URL=https://bb.unson.jp` が登録済みなので、新規 secret 作成は不要。MCP 側で `BRAINBASE_API_URL` を新たな alias として受け入れる。

## 受け入れ基準

### コード

- [ ] `mcp/brainbase/src/config.ts` の `DEFAULT_GRAPH_API_URL` が `https://bb.unson.jp`
- [ ] `loadConfig()` が `BRAINBASE_API_URL` env も `graphApiUrl` として受け付ける (優先順: `BRAINBASE_GRAPH_API_URL` > `BRAINBASE_API_URL` > `BRAINBASE_API_BASE_URL` > default)
- [ ] `mcp/brainbase/tests/config/config.test.ts` の既存テストが新デフォルトに追従し、新規テストで `BRAINBASE_API_URL` 解決を検証
- [ ] `mcp/brainbase/README.md` の env 表が新デフォルトを反映
- [ ] repo grep `graph.brain-base.work` がドキュメント類 (本 Story / 歴史的 story-map / 過去 PR 説明) 以外でゼロ

### 設定 / 配布

- [ ] `.mcp.json` の `mcpServers.brainbase.env` から `BRAINBASE_GRAPH_API_URL` を削除
- [ ] `~/.codex/config.toml` の `[mcp_servers.brainbase.env]` から `BRAINBASE_GRAPH_API_URL` を削除
- [ ] `scripts/run-brainbase-mcp.sh` が `infisical run` で wrap され、`BRAINBASE_API_URL` を `BRAINBASE_GRAPH_API_URL` として export して `node` を exec する
- [ ] Infisical universal-auth file が無い場合は明示エラーで落ちる (silent fallback しない)

### インフラ

- [ ] Lightsail 上で `brainbase-graph-api` コンテナが停止・削除済み (`docker ps | grep -i graph` で出ない)
- [ ] イメージ `brainbase-graph-api:latest` が削除済み (`docker images | grep -i graph` で出ない)
- [ ] Cloudflare の `graph.brain-base.work` DNS レコードが削除済み (`dig @1.1.1.1 graph.brain-base.work +short` が空)
- [ ] `curl -sk https://graph.brain-base.work/` が NXDOMAIN もしくは接続不能 (現状の TLS 即死ではない)

### ドキュメント

- [ ] `docs/architecture/lightsail-infrastructure.md` から `graph.brain-base.work` の行と `docker-compose.graph-api.yml` 章を削除
- [ ] `config/Dockerfile.graph-api` と `config/docker-compose.graph-api.yml` を削除

### 検証

- [ ] MCP daemon 再起動後、`mcp__brainbase__list_entities` が `person` で 50 件以上を返す
- [ ] `npm test -- --runTestsByPath mcp/brainbase/tests/config/config.test.ts` がパス
- [ ] `npm run typecheck` がパス

## 実装タスク

1. clean worktree `fix/decommission-graph-brain-base-work` 作成 (済)
2. Story 本文作成 (本ファイル)
3. TDD: `config.test.ts` を新デフォルトと `BRAINBASE_API_URL` alias で更新 (Red)
4. `mcp/brainbase/src/config.ts` を実装 (Green)
5. `mcp/brainbase/README.md` を更新
6. `scripts/run-brainbase-mcp.sh` を Infisical wrap 仕様に書き換え
7. `.mcp.json` / `~/.codex/config.toml` から env エントリ削除
8. `config/Dockerfile.graph-api` / `config/docker-compose.graph-api.yml` 削除
9. `docs/architecture/lightsail-infrastructure.md` 更新
10. Lightsail SSH で `docker compose -f docker-compose.graph-api.yml down --remove-orphans` + image rm
11. Cloudflare で `graph.brain-base.work` レコード削除
12. `dig` / `curl` で DNS と TLS の死活確認
13. MCP 再起動後 `list_entities person` で疎通確認
14. `vibepro pr prepare` 実行
15. `gh pr create` で PR 提出

## レビュー観点

- Infisical universal-auth file が利用不能な開発者環境でも、エラーメッセージから次のアクションが判る (token file path 提示)
- `BRAINBASE_API_URL` と `BRAINBASE_GRAPH_API_URL` の優先順位がコードと README で一致
- 構成図から消した graph 行が、後続コードや他ドキュメントから参照されていないこと (grep 確認)

## 関連

- 監査 JSON: `/tmp/{claude,codex}_{session,value}_audit.json` (本セッション内で生成)
- 既存 Decision: `decisions/Graphで固有名詞が見つからない場合は、Graph不在と判断せず議事録・transcriptを補助検索する` — 本対応で Graph 直叩きが復活するため、この Decision の前提が緩和される可能性あり
- 既存 Decision: `decisions/Graph API は CSRF だけでなく brainbase 権限ヘッダーも必須` — 本対応後も継続有効
