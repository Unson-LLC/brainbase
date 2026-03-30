---
story_id: STR-001
title: Mesh MVP - AI Agent間リアルタイム問い合わせ基盤
source_requirement:
  nocodb_table: タスク
  requirement_id: ID-170
  requirement_title: "[構想] Hydra型P2P秘密分散によるAgent間通信基盤を設計する"
architecture_docs:
  - path: docs/management/architecture/ADR-001-mesh-architecture.md
    status: created
related_tasks:
  - task_source: NocoDB タスク管理
    task_ids: [170, 171, 172]
status: in_progress
created_at: 2026-03-29
updated_at: 2026-03-29
---

# STR-001: Mesh MVP - AI Agent間リアルタイム問い合わせ基盤

## 背景

現在のBrainbaseは佐藤1人のPC上で動く単一ノード型。業務委託メンバー（3〜7名）とのやりとりはSlackベースの人間同士の会話に依存しており、社長の脳が唯一の「全体像統合ポイント」になっている。

各委託メンバーへの状況確認、判断、調整がすべて社長を経由するため：
- 問い合わせ→返事に30分〜数時間かかる
- 社長が寝てる間は何も進まない
- 委託メンバー同士は社長を介さないと連携できない

POLYTEQ社（白水重明氏）のHydra技術（3つのPCT国際特許）の思想をベースに、各メンバーのPC上のAI Agent同士がリアルタイムで文脈を持って連携できる基盤を構築する。

## 現状

- 各メンバーは自分のPCでClaude Codeを使って作業している
- タスク管理はNocoDB（中央DB）で共有済み
- Agent間の直接通信手段がない
- 「委託Aの作業状況を知りたい」→ Slackで聞く → 返事を待つ → 脳内統合
- Agent同士の暗号化通信手段がない

## 変更内容

### 誰が

- 社長（CEO）のAI Agent
- 業務委託メンバーのAI Agent

### 何を

各メンバーのPC上にMeshServiceを導入し、Agent間で暗号化されたリアルタイム問い合わせ（Query）をできるようにする。

具体的には：
1. **暗号化通信層**: Ed25519署名 + X25519暗号化によるセキュアなenvelope通信
2. **Relay Server**: WebSocketベースの軽量中継サーバー（暗号化envelopeを転送するだけ、中身は見れない）
3. **MeshService**: ノード管理、暗号化通信、ピアレジストリ
4. **QueryHandler**: 問い合わせを受けたノードがローカル文脈（タスク状態、gitブランチ、diff、コミット履歴）を収集して構造化JSONで応答
5. **Permission Checker**: ROLE_RANKベースの権限制御（CEO=全ノード問い合わせ可、Worker=同プロジェクトのみ）
6. **MCP Tools**: Claude Codeから`mesh_query`/`mesh_peers`で呼べるツール
7. **Slackログイン統合**: 既存のSlack認証フローでメッシュ参加も自動完了（招待コード不要）

### なぜ

- **社長の脳のアンロード**: 社長のAIが全ノードに一斉問い合わせ → 数秒で全体像統合
- **委託間の直接連携**: 委託AのAIが委託BのAIに直接質問できる（社長を起こさなくていい）
- **暗黙知の即座の引き出し**: 各Claude Codeが蓄積した作業文脈に基づいた回答が返る
- **セキュリティ**: 生データは一切送信しない。各AIがローカル文脈から回答を生成して、その回答だけがメッシュ上を流れる。通信は全て暗号化

## 受け入れ基準

- [ ] AC-1: `npm start` + Slackログインだけで、メッシュに自動参加できる（招待コード不要）
- [ ] AC-2: CEOのClaude Codeから `mesh_query` で委託メンバーのAIに問い合わせ、ローカル文脈に基づいた構造化JSON応答が返る
- [ ] AC-3: 委託メンバー同士が `mesh_query` で直接やりとりできる（同プロジェクト内のみ）
- [ ] AC-4: 異なるプロジェクトの委託メンバーからの問い合わせは権限エラーで拒否される
- [ ] AC-5: Relay Serverは暗号化envelopeを転送するのみ。Relayサーバー管理者でも通信内容を復号できない
- [ ] AC-6: `mesh_peers` でメッシュに接続中のメンバー一覧が確認できる
- [ ] AC-7: 委託メンバーのオフボーディング時に `mesh revoke` で暗号鍵を失効し、以後の問い合わせを遮断できる
- [ ] AC-8: 全ユニットテスト・結合テストが通過する

## スコープ外

- Hydra特許の二層秘密分散方式（MVPではShamir SSSを使用）
- Secret層（売上・顧客データの秘密分散保護）→ Phase 3で対応
- CEO AIの自律判断（低リスク判断の自動承認）
- WebRTCフルP2P（Relay不要化）
- 分散推論（OSSモデル + コミュニティPCリソース共有）
- モバイル対応
- 本体server.jsへのMeshService統合（別ストーリーで対応）

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・現状・変更内容・受け入れ基準のみ。
