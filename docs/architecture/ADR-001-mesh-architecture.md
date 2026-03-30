---
adr_id: ADR-001
title: Mesh MVP アーキテクチャ - Agent間リアルタイム問い合わせ基盤
status: accepted
date: 2026-03-29
deciders: keigo
---

# ADR-001: Mesh MVP アーキテクチャ

## コンテキスト

Brainbaseを単一ノードからマルチノードに進化させるにあたり、以下の判断が必要だった：

1. Agent間通信方式（P2P vs Relay）
2. 暗号方式（Hydra特許方式 vs 公知技術）
3. データ共有モデル（全データ分散 vs Query層中心）
4. 認証方式（招待コード vs Slack統合）

## 決定

### 1. Relay方式を採用（フルP2Pは見送り）

**理由**: フルP2P（WebRTC）はNAT越えにSTUN/TURNサーバーが必要で、結局Relayと同じ。WebSocket Relayの方がシンプル、デバッグしやすい、3-7人チームには十分。

**Relayの制約**: 暗号化envelopeを転送するだけ。復号鍵を持たない。管理者でも中身を見れない。

### 2. Shamir SSSを採用（Hydra特許方式は見送り）

**理由**: Hydra（WO/2022/039095）の二層秘密分散（P1i + Q2jk）は優れた設計だが、Shamir's Secret Sharing（1979年、パブリックドメイン）で核心の要件は満たせる。ライセンス交渉不要でMVP速度優先。

**移行パス**: `secret-sharing.js`と`secret-distributor.js`のみ差し替えればHydra方式に移行可能。

### 3. Query層中心のデータモデル

**決定の経緯**: 当初は3層モデル（Public/Shared/Secret）でデータを分類して共有する設計だったが、「ファイル共有ならGoogle Drive、タスク共有ならNoCoDBで既にできている。メッシュの価値はそこじゃない」という議論からQuery層中心に転換。

**Query層の定義**: 各ノードのAIがローカル文脈を保持したまま、他ノードからの質問に「回答を生成」して返す仕組み。生データは一切送信しない。

| カテゴリ | 扱い | 実装 |
|---|---|---|
| メタデータ | タスク名、ステータス、期限 | NocoDB（変更なし） |
| Query/Response | Agent間リアルタイム問い合わせ | メッシュの本体 |
| Secret | 売上、顧客リスト、契約金額 | Shamir SSS（Phase 3） |
| Local | 会話ログ、terminal output、.env | 共有しない |

### 4. Slackログイン = メッシュ参加（招待コード廃止）

**理由**: Slackワークスペースに入っている = 佐藤が招待済み = 信頼済み。二重チェックの意味がない。ROLE_RANKが既にauth-serviceにあるため、鍵スコープの自動決定にそのまま使える。

### 5. 鍵 = 問い合わせ範囲 = 組織権限

CEO鍵（ROLE_RANK=3）は全ノードに問い合わせ可能。Worker鍵（ROLE_RANK=1）は同プロジェクトのノードのみ。暗号の鍵配布が組織の権限設計そのものになる。

### 6. 各自負担・オンライン前提

問い合わせのトークンコストは各ノード自前。オフラインノードには問い合わせ不能（Slackと同じ）。

## 技術選定

| 用途 | 選択 | 理由 |
|---|---|---|
| 非対称暗号 | libsodium-wrappers | Ed25519 + X25519。Pure JS、ネイティブコンパイル不要 |
| 秘密分散 | shamirs-secret-sharing | パブリックドメイン。Hydra方式への移行容易 |
| Relay通信 | ws (npm) | 既存依存。WebSocket標準 |
| Relayホスティング | Fly.io無料枠 | コスト0 |
| ローカル状態DB | better-sqlite3 | 組み込み型、設定不要 |

## Hydra特許との関係（参考）

| 特許 | 内容 | MVP対応 |
|---|---|---|
| WO/2022/039095 | 秘密分散（二層構造） | Shamir SSSで代替。差し替え可能 |
| WO/2022/039278 | P2Pルーティング（ツリー構造） | Relay方式で代替 |
| WO/2022/004894 | 多重因子三点認証 | Slackログイン + Ed25519鍵で代替 |

MVP後にライセンス取得 or 回避設計の最終判断を行う。

## 結果

Phase 1実装完了（23ファイル、+1,986行、31テスト全通過）。`feature/mesh-mvp-phase1`ブランチにコミット済み。
