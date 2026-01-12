# AITM Dashboard API仕様書

**バージョン**: 1.0.0
**作成日**: 2026-01-11
**対象**: フロントエンド開発者、API統合担当者

---

## 目次

1. [概要](#1-概要)
2. [Base URL](#2-base-url)
3. [認証](#3-認証)
4. [エンドポイント一覧](#4-エンドポイント一覧)
5. [システム情報API](#5-システム情報api)
6. [プロジェクト管理API](#6-プロジェクト管理api)
7. [Mana統計API](#7-mana統計api)
8. [GitHub連携API](#8-github連携api)
9. [エラーレスポンス](#9-エラーレスポンス)
10. [キャッシュとRate Limiting](#10-キャッシュとrate-limiting)

---

## 1. 概要

AITM (AI Technical Management) Dashboard APIは、プロジェクト管理・健全性スコア・Critical Alerts・Manaワークフロー統計を提供するRESTful APIです。

**特徴**:
- NocoDB実データ統合
- In-processキャッシュによる高速レスポンス
- 3階層意思決定モデル対応（CRITICAL/STRATEGIC/OPERATIONAL）

---

## 2. Base URL

| 環境 | Base URL |
|------|----------|
| 開発 | `http://localhost:3005` |
| 本番 | `https://brainbase.unson.jp` |

**エンドポイントプレフィックス**: `/api/brainbase`

**例**:
```
開発: http://localhost:3005/api/brainbase/projects
本番: https://brainbase.unson.jp/api/brainbase/projects
```

---

## 3. 認証

**現在**: 認証なし（内部ツール）

**将来**: APIキーベース認証を検討（Phase 3）

---

## 4. エンドポイント一覧

| エンドポイント | メソッド | 説明 | キャッシュ |
|--------------|---------|------|-----------|
| `/` | GET | システム概要 | - |
| `/system` | GET | システム情報 | - |
| `/system-health` | GET | システムヘルス | - |
| `/storage` | GET | ストレージ情報 | - |
| `/tasks` | GET | タスク管理ステータス | - |
| `/worktrees` | GET | Worktree情報 | - |
| `/projects` | GET | 全プロジェクトの健全性スコア | - |
| `/projects/:id/stats` | GET | 指定プロジェクトの統計 | - |
| `/critical-alerts` | GET | Critical Alerts取得 | 5分 |
| `/strategic-overview` | GET | 戦略的意思決定支援情報 | 5分 |
| `/trends` | GET | プロジェクトの健全性トレンド | - |
| `/mana-workflow-stats` | GET | Manaワークフロー統計 | 1分 |
| `/github/runners` | GET | GitHub Runners情報 | - |
| `/github/workflows` | GET | GitHub Workflows情報 | - |

---

## 5. システム情報API

### 5.1 GET /api/brainbase

**概要**: システム全体の概要を取得

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase
```

**レスポンス**:
```json
{
  "success": true,
  "version": "1.0.0",
  "uptime": "2h 35m 12s",
  "message": "brainbase API is running"
}
```

---

### 5.2 GET /api/brainbase/system

**概要**: システム情報（CPU・メモリ・ディスク）を取得

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/system
```

**レスポンス**:
```json
{
  "success": true,
  "data": {
    "hostname": "MacBook-Pro.local",
    "platform": "darwin",
    "uptime": 9384,
    "cpu": {
      "model": "Apple M1 Pro",
      "cores": 10,
      "usage": 25.3
    },
    "memory": {
      "total": "32 GB",
      "free": "18 GB",
      "used": "14 GB",
      "usage": 43.75
    },
    "disk": {
      "total": "1 TB",
      "free": "500 GB",
      "used": "500 GB",
      "usage": 50.0
    }
  }
}
```

---

### 5.3 GET /api/brainbase/system-health

**概要**: システムヘルスチェック（詳細版）

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/system-health
```

**レスポンス**:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "checks": {
      "database": {
        "status": "healthy",
        "latency": 12
      },
      "filesystem": {
        "status": "healthy",
        "writable": true
      },
      "memory": {
        "status": "warning",
        "usage": 85.2
      }
    },
    "timestamp": "2026-01-11T14:30:00Z"
  }
}
```

**ヘルスステータス**:
- `healthy`: 正常
- `warning`: 注意（80%以上の使用率）
- `critical`: 危険（90%以上の使用率）

---

### 5.4 GET /api/brainbase/storage

**概要**: ストレージ情報を取得

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/storage
```

**レスポンス**:
```json
{
  "total": "1 TB",
  "free": "500 GB",
  "used": "500 GB",
  "usage": 50.0,
  "breakdown": {
    "codex": "120 GB",
    "tasks": "50 GB",
    "inbox": "30 GB",
    "schedules": "20 GB",
    "worktrees": "280 GB"
  }
}
```

---

### 5.5 GET /api/brainbase/tasks

**概要**: タスク管理ステータスを取得

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/tasks
```

**レスポンス**:
```json
{
  "total": 42,
  "completed": 15,
  "inProgress": 10,
  "pending": 12,
  "blocked": 3,
  "overdue": 2,
  "overdueList": [
    {
      "title": "Week 10 Task 5完了",
      "deadline": "2026-01-05",
      "status": "in_progress"
    },
    {
      "title": "メール返信",
      "deadline": "2026-01-08",
      "status": "pending"
    }
  ],
  "focus": {
    "title": "Week 11-12 API.md作成",
    "status": "in_progress",
    "deadline": "2026-01-12"
  }
}
```

---

### 5.6 GET /api/brainbase/worktrees

**概要**: Worktree情報を取得

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/worktrees
```

**レスポンス**:
```json
{
  "total": 3,
  "active": 2,
  "uncommitted": 1,
  "list": [
    {
      "branch": "session/session-1767361754399",
      "path": "/Users/ksato/workspace/shared/.worktrees/session-1767361754399-brainbase"
    },
    {
      "branch": "feature/dashboard-v2",
      "path": "/Users/ksato/workspace/shared/.worktrees/feature-dashboard-v2"
    }
  ]
}
```

---

## 6. プロジェクト管理API

### 6.1 GET /api/brainbase/projects

**概要**: 全プロジェクトの健全性スコアを取得（NocoDB実データ使用）

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/projects
```

**レスポンス**:
```json
[
  {
    "id": "brainbase",
    "name": "brainbase",
    "healthScore": 92,
    "overdue": 2,
    "blocked": 1,
    "completionRate": 75,
    "manaScore": 92
  },
  {
    "id": "salestailor",
    "name": "salestailor",
    "healthScore": 85,
    "overdue": 3,
    "blocked": 2,
    "completionRate": 68,
    "manaScore": 92
  },
  {
    "id": "zeims",
    "name": "zeims",
    "healthScore": 78,
    "overdue": 5,
    "blocked": 3,
    "completionRate": 60,
    "manaScore": 92
  }
]
```

**Health Score計算式**:
```
healthScore = (completionRate * 0.3)
            + (overdueScore * 0.2)
            + (blockedScore * 0.2)
            + (milestoneProgress * 0.3)

overdueScore = max(0, 100 - (overdue * 10))
blockedScore = max(0, 100 - (blocked * 20))
```

**ソート**: Health Scoreの降順

---

### 6.2 GET /api/brainbase/projects/:id/stats

**概要**: 指定プロジェクトの詳細統計を取得

**パラメータ**:
- `id` (required): プロジェクトID（例: `brainbase`, `salestailor`）

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/projects/brainbase/stats
```

**レスポンス**:
```json
{
  "total": 42,
  "completed": 30,
  "inProgress": 8,
  "pending": 2,
  "blocked": 1,
  "overdue": 1,
  "completionRate": 71,
  "averageProgress": 82
}
```

**エラーレスポンス（404）**:
```json
{
  "error": "Project not found",
  "message": "Project 'non-existent' not found or archived"
}
```

---

### 6.3 GET /api/brainbase/critical-alerts

**概要**: Critical Alerts取得（ブロッカー + 期限超過タスク）

**キャッシュ**: 5分（300秒）

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/critical-alerts
```

**レスポンス**:
```json
{
  "alerts": [
    {
      "type": "blocker",
      "project": "brainbase",
      "task": "API認証エラー",
      "owner": "太田",
      "days_blocked": 5,
      "severity": "critical"
    },
    {
      "type": "overdue",
      "project": "salestailor",
      "task": "決済機能実装",
      "owner": "担当者",
      "days_overdue": 3,
      "deadline": "2026-01-08",
      "severity": "warning"
    },
    {
      "type": "mana_anomaly",
      "workflow_id": "m3",
      "success_rate": 65,
      "threshold": 70,
      "severity": "warning"
    }
  ],
  "total_critical": 1,
  "total_warning": 2
}
```

**Alert Types**:
- `blocker`: ブロッカータスク（severity: critical）
- `overdue`: 期限超過タスク（severity: warning）
- `mana_anomaly`: Mana品質低下（severity: warning）

---

### 6.4 GET /api/brainbase/strategic-overview

**概要**: 戦略的意思決定支援情報（プロジェクト優先度 + リソース配分）

**キャッシュ**: 5分（300秒）

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/strategic-overview
```

**レスポンス**:
```json
{
  "projects": [
    {
      "name": "brainbase",
      "health_score": 92,
      "trend": "up",
      "change": 3,
      "overdue": 2,
      "blocked": 1,
      "completion_rate": 75,
      "milestone_progress": 85,
      "recommendations": [
        "健全。現状維持でOK"
      ]
    },
    {
      "name": "zeims",
      "health_score": 58,
      "trend": "down",
      "change": -5,
      "overdue": 8,
      "blocked": 4,
      "completion_rate": 45,
      "milestone_progress": 50,
      "recommendations": [
        "要注意。リソース追加またはスコープ見直しを検討",
        "期限超過が多数。緊急対応が必要",
        "複数のブロッカーが存在。即座の解消が必要"
      ]
    }
  ],
  "bottlenecks": [
    {
      "type": "project_overload",
      "project": "zeims",
      "task_count": 12,
      "recommendation": "zeimsにタスクが集中。他プロジェクトとの調整を推奨"
    },
    {
      "type": "overall_resource_shortage",
      "affected_projects": 2,
      "recommendation": "複数プロジェクトで健全性低下。全体的なリソース見直しが必要"
    }
  ]
}
```

**Trend Types**:
- `up`: 改善傾向（health_score >= 80）
- `down`: 悪化傾向（health_score < 60）
- `stable`: 安定（60 <= health_score < 80）

**Bottleneck Types**:
- `project_overload`: プロジェクト過負荷
- `overall_resource_shortage`: 全体的リソース不足

---

### 6.5 GET /api/brainbase/trends

**概要**: プロジェクトの健全性トレンド取得（過去N日間の履歴データ）

**クエリパラメータ**:
- `project_id` (required): プロジェクトID（例: `brainbase`）
- `days` (optional): 取得日数（デフォルト: 30日）

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/trends?project_id=brainbase&days=30
```

**レスポンス**:
```json
{
  "project_id": "brainbase",
  "snapshots": [
    {
      "snapshot_date": "2026-01-11",
      "total_tasks": 42,
      "completed_tasks": 30,
      "overdue_tasks": 1,
      "blocked_tasks": 1,
      "completion_rate": 71,
      "milestone_progress": 82,
      "health_score": 92
    },
    {
      "snapshot_date": "2026-01-10",
      "total_tasks": 40,
      "completed_tasks": 28,
      "overdue_tasks": 2,
      "blocked_tasks": 2,
      "completion_rate": 70,
      "milestone_progress": 80,
      "health_score": 89
    }
  ],
  "trend_analysis": {
    "trend": "up",
    "health_score_change": 3,
    "alert_level": "none"
  }
}
```

**エラーレスポンス（400）**:
```json
{
  "error": "project_id is required",
  "message": "Please provide a project_id query parameter"
}
```

---

## 7. Mana統計API

### 7.1 GET /api/brainbase/mana-workflow-stats

**概要**: Manaワークフロー統計を取得

**キャッシュ**: 1分（60秒）

**クエリパラメータ**:
- `workflow_id` (optional): ワークフローID（例: `m1`, `m2`）
  - 指定なし: 全ワークフローの統計
  - 指定あり: 該当ワークフローのみの統計

**リクエスト（全体統計）**:
```bash
curl http://localhost:3005/api/brainbase/mana-workflow-stats
```

**レスポンス（全体統計）**:
```json
{
  "workflow_id": null,
  "stats": {
    "total_executions": 150,
    "total_success": 135,
    "total_failure": 15,
    "success_rate": 90
  }
}
```

**リクエスト（個別統計）**:
```bash
curl http://localhost:3005/api/brainbase/mana-workflow-stats?workflow_id=m1
```

**レスポンス（個別統計）**:
```json
{
  "workflow_id": "m1",
  "stats": {
    "total_executions": 50,
    "total_success": 45,
    "total_failure": 5,
    "success_rate": 90
  }
}
```

**エラーレスポンス（400）**:
```json
{
  "error": "Invalid workflow_id",
  "message": "workflow_id cannot be an empty string"
}
```

---

## 8. GitHub連携API

### 8.1 GET /api/brainbase/github/runners

**概要**: GitHub Self-Hosted Runners情報を取得

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/github/runners
```

**レスポンス**:
```json
{
  "success": true,
  "runners": [
    {
      "id": 123,
      "name": "brainbase-runner-1",
      "os": "macOS",
      "status": "online",
      "busy": false,
      "labels": ["self-hosted", "macOS", "ARM64"]
    },
    {
      "id": 124,
      "name": "brainbase-runner-2",
      "os": "Linux",
      "status": "offline",
      "busy": false,
      "labels": ["self-hosted", "Linux", "X64"]
    }
  ],
  "total_runners": 2,
  "online_runners": 1
}
```

---

### 8.2 GET /api/brainbase/github/workflows

**概要**: GitHub Workflow Runs情報を取得（直近5件）

**リクエスト**:
```bash
curl http://localhost:3005/api/brainbase/github/workflows
```

**レスポンス**:
```json
{
  "success": true,
  "workflows": [
    {
      "id": 12345678,
      "name": "CI/CD Pipeline",
      "status": "completed",
      "conclusion": "success",
      "head_branch": "main",
      "event": "push",
      "created_at": "2026-01-11T10:30:00Z",
      "updated_at": "2026-01-11T10:35:00Z",
      "run_number": 42
    },
    {
      "id": 12345677,
      "name": "Test Suite",
      "status": "completed",
      "conclusion": "failure",
      "head_branch": "feature/api-docs",
      "event": "pull_request",
      "created_at": "2026-01-11T09:00:00Z",
      "updated_at": "2026-01-11T09:10:00Z",
      "run_number": 41
    }
  ]
}
```

**Workflow Status**:
- `queued`: キューイング中
- `in_progress`: 実行中
- `completed`: 完了

**Workflow Conclusion**:
- `success`: 成功
- `failure`: 失敗
- `cancelled`: キャンセル
- `skipped`: スキップ

---

## 9. エラーレスポンス

### 9.1 一般的なエラーフォーマット

```json
{
  "success": false,
  "error": "エラーメッセージ",
  "message": "詳細な説明（オプション）"
}
```

### 9.2 HTTPステータスコード

| ステータス | 意味 | 用途 |
|-----------|------|------|
| 200 | OK | リクエスト成功 |
| 400 | Bad Request | クエリパラメータ不正 |
| 404 | Not Found | リソース不在 |
| 500 | Internal Server Error | サーバー内部エラー |

### 9.3 エラーケース例

**400 Bad Request**:
```json
{
  "error": "Invalid workflow_id",
  "message": "workflow_id cannot be an empty string"
}
```

**404 Not Found**:
```json
{
  "error": "Project not found",
  "message": "Project 'non-existent' not found or archived"
}
```

**500 Internal Server Error**:
```json
{
  "success": false,
  "error": "Failed to fetch projects"
}
```

---

## 10. キャッシュとRate Limiting

### 10.1 キャッシュ戦略

AITM Dashboard APIは、In-process Cache（node-cache）を使用してパフォーマンスを最適化しています。

| エンドポイント | TTL | 理由 |
|--------------|-----|------|
| `/critical-alerts` | 5分（300秒） | 頻繁に変わらないデータ |
| `/strategic-overview` | 5分（300秒） | 頻繁に変わらないデータ |
| `/mana-workflow-stats` | 1分（60秒） | リアルタイム性が必要 |

**キャッシュキー形式**: `${req.originalUrl}`

**例**: `/api/brainbase/critical-alerts` → キャッシュキー: `/api/brainbase/critical-alerts`

### 10.2 キャッシュクリア

キャッシュは以下の条件で自動的にクリアされます：

1. **TTL期限切れ**: 指定時間経過後に自動削除
2. **POST/PUT/DELETE操作**: データ更新時にパターンマッチでクリア

**Example**:
```javascript
// プロジェクト更新時に /projects 関連のキャッシュをクリア
clearCache('projects');

// 全キャッシュクリア
clearCache('');
```

### 10.3 Rate Limiting

**現在**: Rate Limitingなし（内部ツール）

**将来**: 以下のRate Limitingを検討（Phase 3）
- 1秒あたり10リクエスト
- 1分あたり100リクエスト
- 1時間あたり1000リクエスト

---

## 11. よくある質問（FAQ）

### Q1: APIのレスポンスが遅い場合は？

**A**: 以下を確認してください：

1. **キャッシュ確認**: キャッシュ対象エンドポイントか確認
2. **NocoDB接続**: NocoDBのレスポンス時間を確認
3. **ネットワーク**: VPN接続を確認

**デバッグ方法**:
```bash
# ログレベルを debug に設定
LOG_LEVEL=debug npm run dev

# APIレスポンス時間計測
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3005/api/brainbase/projects
```

### Q2: NocoDB APIエラーが発生した場合は？

**A**: 以下を確認してください：

1. **環境変数**: `NOCODB_BASE_URL`, `NOCODB_API_TOKEN` が設定されているか
2. **NocoDB接続**: NocoDBサーバーが起動しているか
3. **project_id**: config.ymlのproject_idが正しいか

### Q3: Health Scoreが期待値と異なる場合は？

**A**: 以下を確認してください：

1. **NocoDB UI**: NocoDB UIでタスクデータを直接確認
2. **タスクステータス**: タスクのステータスが正しいか確認
3. **計算ロジック**: `brainbase.js`の計算式を確認

**Health Score計算式（再掲）**:
```
healthScore = (completionRate * 0.3)
            + (overdueScore * 0.2)
            + (blockedScore * 0.2)
            + (milestoneProgress * 0.3)
```

### Q4: キャッシュをクリアしたい場合は？

**A**: サーバーを再起動するか、以下のコマンドを実行：

```bash
# サーバー再起動
npm run dev

# またはPM2の場合
pm2 restart brainbase
```

### Q5: APIドキュメントの最新版はどこ？

**A**: 以下のファイルを参照してください：
- **このファイル**: `/docs/API.md`
- **コード**: `/server/routes/brainbase.js`
- **USER_GUIDE**: `/docs/USER_GUIDE.md`

---

## 12. 変更履歴

| バージョン | 日付 | 変更内容 |
|----------|------|---------|
| 1.0.0 | 2026-01-11 | 初版作成 |

---

## 13. 参考リンク

- [USER_GUIDE.md](./USER_GUIDE.md): ユーザーガイド
- [DESIGN.md](../DESIGN.md): UI/UXデザイン仕様
- [REFACTORING_PLAN.md](./REFACTORING_PLAN.md): リファクタリング計画

---

**最終更新**: 2026-01-11
**作成者**: Unson LLC
**フィードバック**: 改善提案は GitHub Issues へ
