---
story_id: STR-001
frame_id: mesh-ai-driven-management
horizon: quarter
view: business
name: "社長として、全委託メンバーのAIに一斉問い合わせして、数秒で全体像を統合したい"
enemy: "Slackで個別に聞いて回る → 返事待ち数時間 → 脳内統合という人力プロセス"
criteria:
  - type: commit
    description: "CEOのClaude Codeからmesh_queryで全ノードに一斉問い合わせし、各AIのローカル文脈に基づいた構造化応答が返る"
  - type: commit
    description: "委託メンバー同士がmesh_queryで直接やりとりできる（同プロジェクト内のみ）"
  - type: commit
    description: "npm start + Slackログインだけでメッシュに自動参加できる（招待コード不要）"
  - type: commit
    description: "Relay Serverは暗号化envelopeを転送するのみ。管理者でも内容を復号できない"
  - type: commit
    description: "異なるプロジェクトの委託メンバーからの問い合わせは権限エラーで拒否される"
  - type: signal
    description: "社長の状況把握にかかる時間が30分/日 → 5分/日以下に減る"
  - type: signal
    description: "委託メンバー間の連携で社長を経由する回数が半減する"
status: in_progress
created_at: 2026-03-29
updated_at: 2026-03-29
---

# ストーリー: 全委託メンバーのAIに一斉問い合わせして数秒で全体像を統合したい

## ユーザーストーリー

一人社長として、各業務委託メンバーのPC上で動いているAI Agentに一斉問い合わせして、全プロジェクトの現在の状況を数秒で把握したい。Slackで個別に聞いて返事を待つ人力プロセスを無くしたい。

## 受入条件

### commit（絶対完了条件）

- [ ] AC-1: CEOのClaude Codeから`mesh_query`で全ノードに一斉問い合わせし、各AIのローカル文脈（タスク状態、gitブランチ、diff、コミット履歴）に基づいた構造化JSON応答が返る
- [ ] AC-2: 委託メンバー同士が`mesh_query`で直接やりとりできる（同プロジェクト内のみ）
- [ ] AC-3: `npm start` + Slackログインだけでメッシュに自動参加できる（招待コード不要、鍵生成も自動）
- [ ] AC-4: 異なるプロジェクトの委託メンバーからの問い合わせは権限エラーで拒否される
- [ ] AC-5: Relay Serverは暗号化envelopeを転送するのみ。Relay管理者でも通信内容を復号できない
- [ ] AC-6: `mesh_peers`でメッシュに接続中のメンバー一覧が確認できる
- [ ] AC-7: 委託メンバーのオフボーディング時に暗号鍵を失効し、以後の問い合わせを遮断できる

### signal（検証シグナル）

- [ ] SIG-1: 社長の状況把握にかかる時間が30分/日 → 5分/日以下に減る
- [ ] SIG-2: 委託メンバー間の連携で社長を経由する回数が半減する

## スコープ外

- Secret層（売上・顧客データの秘密分散保護）
- CEO AIの自律判断（低リスク判断の自動承認）
- 分散推論（OSSモデル + コミュニティPCリソース共有）
- WebRTCフルP2P（Relay不要化）
- モバイル対応
- CEO統合ビュー（UIダッシュボード）→ 別Story
