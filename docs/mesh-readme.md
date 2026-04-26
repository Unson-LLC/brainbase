# Mesh MVP ドキュメント目次

業務委託メンバー間の AI Agent リアルタイム連携基盤の関連ドキュメント一覧。

## Story 駆動開発パイプライン

```
Frame → Story → Architecture → Spec → TDD → Code
```

| 層 | ファイル | 役割 |
|---|---|---|
| **Frame (上位)** | `docs/stories/ai-first-brainbase-story-map.md` の Frame セクション | 集約層+分散層の二層モデル定義 |
| **Frame (Mesh詳細)** | `docs/frames/mesh-ai-driven-management.md` | 分散層の世界観・設計思想・語彙・判断軸 |
| **Story Map** | `docs/stories/ai-first-brainbase-story-map.md` | Northstar→Annual→Quarter→Month→Sprintの階層 |
| **Story (Sprint)** | `docs/stories/mesh-agent-query-story.md` | 誰が・何を・なぜ + 受入条件 |
| **Architecture** | `docs/architecture/mesh-agent-query-architecture.md` | 3レイヤー構造、境界、Node Profile、Workspace Scope、SSOTの所在 |
| **ADR** | `docs/architecture/ADR-002-mesh-architecture.md` | 6つのアーキテクチャ判断記録 |
| **Spec** | `docs/specs/mesh-agent-query-spec.md` | API、Envelope、MCP Tool、Permission、REST API定義 |

## ストーリー階層

```
frame-2026-ai-first-company-os
  └ northstar.brainbase.ai-first-company-os
    └ annual.brainbase.ai-first-operating-loop
      └ quarter.brainbase.distributed-agent-mesh           ← Mesh の Quarter
        └ month.brainbase.mesh-mvp-foundation              ← Mesh の Month
          └ sprint.brainbase.mesh-agent-query (旧STR-001)  ← Mesh の Sprint
```

## NocoDB との対応

| NocoDB | ID | 内容 |
|---|---|---|
| マイルストーン | 41 | Q3.5: 分散Agentメッシュ確立 (Mesh MVP) |
| シップ | 34 | Mesh MVP Phase 1: Agent間リアルタイム連携基盤 (shipped) |
| タスク | 304-313 | Phase 1+2 実装タスク (全て完了) |
| タスク | 314-317 | Phase 3 残タスク (Relay デプロイ、E2E、Slack統合、配布) |
| タスク (旧) | 170-172 | 構想・調査・設計タスク (完了済み、レガシー) |

## 実装済みコード

```
server/mesh/
├── crypto/
│   ├── sodium-init.js          # libsodium 初期化集約
│   ├── key-manager.js          # Ed25519 + X25519 鍵管理
│   └── envelope-crypto.js      # seal/unseal/sign/verify
├── query/
│   ├── query-handler.js        # 問い合わせ受信→応答
│   ├── local-context-collector.js  # ローカル文脈収集
│   └── permission-checker.js   # ROLE_RANK 権限判定
├── envelope.js                 # envelope 形式定義
├── mesh-service.js             # メッシュサービス本体
├── relay-client.js             # Relay 接続管理
├── peer-registry.js            # ピア管理 (class)
├── message-router.js           # メッセージルーティング (class)
└── node-profile.js             # config.yml → NodeProfile 構築

relay/
├── server.js                   # WebSocket Relay (createRelayServer 関数)
├── package.json
└── Dockerfile

mcp/brainbase/src/tools/
└── mesh-tools.ts               # mesh_query / mesh_peers MCP Tool

server/routes/
└── mesh.js                     # /api/mesh ルート

server.js                       # MeshService 統合 (条件付き起動)

tests/mesh/                     # 41テスト全通過
```

## Phase 進捗

| Phase | 内容 | 状態 |
|---|---|---|
| Phase 1 | 暗号層 + Relay + MeshService + QueryHandler + MCP Tools | ✅ 完了 |
| Phase 2 | NodeProfile + server.js統合 + DRYリファクタ + Story駆動 | ✅ 完了 |
| Spec 補強 | エラーモデル + セキュリティ境界 + 実装ステータスマトリクス + 用語集 (§11-§16) | ✅ 完了 |
| Phase 3 | Relayデプロイ + E2E検証 + Slack統合 + 配布 + Spec乖離解消 | ⏳ 未着手 |

### Spec §15 実装ステータスマトリクスより、Phase 3 で追加すべき新規タスク

- POST /api/mesh/query を同期+30秒タイムアウト化
- routes/mesh.js を asyncHandler + AppError 統一
- MCP Tool エラーレスポンス（isError:true）対応
- LocalContextCollector を NodeProfile.projects[] 全プロジェクト対応
- MESH_AGENT_RUNTIME 環境変数の実装結合
- revoke / peer_revoked プロトコル実装（Relay側 + CLI側）
- mesh revoke CLI 実装
- server/mesh/errors.js 新規作成 (MeshErrorCodes)
- envelope ts/nonce 検証 (リプレイ攻撃対策)
- envelope サイズ上限（1MB / 64KB / 512KB）
- Relay 同時接続数制限 + 重複nodeId拒否
- Relay deny-list SQLite 永続化
- Phase 3 追加テスト（リプレイ、サイズ、接続数、deny-list、revoke、Slack統合）
- ログフォーマット統一 `[Mesh][${nodeId.slice(0,8)}] ...`

## 関連 Hydra 特許 (技術的着想元)

- WO/2022/039095 — 秘密分散 (二層構造)
- WO/2022/039278 — P2P ルーティング (ツリー構造)
- WO/2022/004894 — 多重因子三点認証
- 出願人: POLYTEQ LTD. / 発明者: HAKUSUI Shigeaki

MVP では公知技術 (libsodium + Shamir SSS + WebSocket Relay) で実装。Hydra特許への移行パスは残してある。
