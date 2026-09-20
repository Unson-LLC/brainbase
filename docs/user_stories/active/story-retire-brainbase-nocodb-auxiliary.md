---
story_id: story-retire-brainbase-nocodb-auxiliary
title: BrainbaseのNocoDB補助HTTP経路を退役させる
status: active
created_at: 2026-09-20
---

# BrainbaseのNocoDB補助HTTP経路を退役させる

利用者はNocoDBを利用していないため、旧ダッシュボード専用のアラート・統計・トレンド経路を明示的に退役させたい。Graphのプロジェクト一覧、共有認証、Slack/Google連携、Personal Knowledgeなど現行機能は保持する。

## 受け入れ条件

- `/api/brainbase/critical-alerts`、`/strategic-overview`、`/projects/:id/stats`、`/trends`、`/trends/heatmap`は、クエリやfixture指定に関係なく410と`capability_retired`を返す。
- 退役した経路はNocoDBServiceを生成・注入・呼出しせず、空配列やゼロ値を成功応答として返さない。
- Graphの`/api/brainbase/projects`と概要のプロジェクト一覧はアクセス境界を保ち、NocoDB由来の健康値がない場合は`unavailable`とnull値で明示する。
- Slack/Google共有認証、Graph/InfoSSOT/learning/Personal Knowledgeの経路、保存データは変更しない。
- 変更はコードと対象テスト・仕様文書に限定し、データ削除、本番操作、外部送信は行わない。

仕様: `docs/specs/story-retire-brainbase-nocodb-auxiliary-spec.md`
