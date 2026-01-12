# AITM Dashboard 設計書

**バージョン**: 1.0.0
**作成日**: 2026-01-09
**ステータス**: Design Phase
**実装期間**: 8-12週間（Week 1-2からWeek 11-12）

---

## 1. プロジェクト概要

### 1.1 目的

brainbaseダッシュボードを**AITM（AI Technical Management）ダッシュボード**として全面再設計し、「意思決定支援」に特化したシステムを構築する。

### 1.2 背景

**現状の課題**:
- 時系列データが存在しない（トレンド分析不可能）
- Section 4-6はモック/ハードコード
- 「何を見るべきか」の意思決定モデルが不在

**解決策**:
- AITMダッシュボードの哲学を確立
- 全7セクションを意思決定支援に特化
- NocoDB履歴テーブルでトレンド分析を実現

### 1.3 核心原則

**「意思決定支援」が唯一の目的**

従来のダッシュボード: 「何が起きているか」を見せる
AITMダッシュボード: 「何を決めるべきか」を提示

**Skills統合**:
- `manager-leverage`: レバレッジ3倍（30分→10分）、1対多の情報提供
- `ui-design-resources`: n8n型ダークテーマ、グラスモーフィズム、shadcn/ui
- `kpi-calculation`: タスク一本化率90%、RACI運用率80%
- `saas-ai-roadmap-playbook`: CPF→PSF→SPF→PMFバリデーション段階
- `leadership-frameworks`: EOS 6モジュール、IDS（Identify/Discuss/Solve）

---

## 2. システム要件

### 2.1 機能要件

**3階層意思決定モデル**:

| レベル | 内容 | 頻度 | 該当セクション |
|--------|------|------|---------------|
| Level 1: CRITICAL | 今すぐ決めるべき（ブロッカー、期限超過、Mana品質低下） | リアルタイム | Section 1 |
| Level 2: STRATEGIC | 週次で決めるべき（優先順位調整、リソース配分、マイルストーン評価） | 週次 | Section 2 |
| Level 3: OPERATIONAL | 日次で確認すべき（タスク完了状況、健全性スコア） | 日次 | Section 3 |

### 2.2 非機能要件

| 項目 | 要件 |
|------|------|
| **パフォーマンス** | API応答時間 < 500ms、ページロード < 2秒 |
| **可用性** | 99.9%以上（ダウンタイム月7分以内） |
| **拡張性** | プロジェクト数100まで対応 |
| **保守性** | コード品質80%以上、ドキュメント整備 |
| **セキュリティ** | CSRF対策、XSS対策、入力検証 |

---

## 3. アーキテクチャ設計

### 3.1 システムアーキテクチャ

```
┌─────────────────────────────────────────────────┐
│ Client（ブラウザ）                               │
│   ├── Dashboard UI（7セクション）               │
│   ├── EventBus（イベント駆動）                  │
│   └── Reactive Store（状態管理）                │
├─────────────────────────────────────────────────┤
│ Server（Express.js）                             │
│   ├── /api/brainbase/critical-alerts            │
│   ├── /api/brainbase/strategic-overview         │
│   ├── /api/brainbase/trends                     │
│   └── /api/brainbase/projects                   │
├─────────────────────────────────────────────────┤
│ Data Layer                                       │
│   ├── NocoDB API（プロジェクト統計）            │
│   ├── NocoDB履歴テーブル（トレンドデータ）      │
│   ├── Mana S3（ワークフロー実行履歴）           │
│   └── _codex（戦略、RACI）                      │
├─────────────────────────────────────────────────┤
│ Automation                                       │
│   └── GitHub Actions Cron Job（日次スナップ）  │
└─────────────────────────────────────────────────┘
```

### 3.2 データフロー

**ユーザー操作フロー**:
```
1. ユーザー: ダッシュボード表示
   ↓
2. Client: GET /api/brainbase（全セクションデータ取得）
   ↓
3. Server: NocoDB API呼び出し
   ↓
4. Server: レスポンス返却（JSON）
   ↓
5. Client: Reactive Storeに保存
   ↓
6. Client: EventBus発火（DASHBOARD_LOADED）
   ↓
7. Client: UI自動更新
```

**日次スナップショットフロー**:
```
1. GitHub Actions: 毎日00:00 JST（15:00 UTC）
   ↓
2. scripts/daily-snapshot.js実行
   ↓
3. NocoDB APIで全プロジェクト統計取得
   ↓
4. Health Score計算
   ↓
5. NocoDB履歴テーブルに挿入（UNIQUE制約: project_id + snapshot_date）
```

---

## 4. UI/UX仕様

### 4.1 デザインシステム

**カラーパレット**（n8n型ダークテーマ）:

```css
/* 背景色 */
--navy-midnight: #0e0918;
--navy-deep: #1f192a;
--navy-dark: #1b1728;

/* テキスト色 */
--text-primary: #c4bbd3;
--text-secondary: #6f87a0;

/* アクセント色 */
--accent-orange: #ee4f27;   /* プライマリCTA */
--accent-amber: #ff9b26;    /* セカンダリCTA */
--accent-green: #35a670;    /* 成功状態 */
--accent-purple: #6b21ef;   /* インタラクティブ要素 */

/* 白のオーバーレイ */
--overlay-5: rgba(255, 255, 255, 0.05);
--overlay-10: rgba(255, 255, 255, 0.1);
--overlay-15: rgba(255, 255, 255, 0.15);
```

**タイポグラフィ**:

| レベル | サイズ | 行高 | 用途 |
|--------|--------|------|------|
| H1 | 56px | 100% | メインヒーロー |
| H2 | 54px | 100% | セクション見出し |
| H3 | 48px | 100% | サブセクション |
| Body-lg | 18px | 150% | リード文 |
| Body | 16px | 160% | 本文 |

**レイアウトグリッド**:
- コンテナ: `max-w-[1312px] mx-auto px-4`
- 12カラムグリッド: `grid grid-cols-12 gap-4 md:gap-8 lg:gap-16`
- レスポンシブブレイクポイント: `sm: 640px`, `md: 810px`, `lg: 1200px`

### 4.2 コンポーネント設計

**グラスモーフィズムカード**:
```css
.glassmorphism-card {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(30px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 24px;
}

.glassmorphism-card:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  transition: all 0.3s;
}
```

**デュアルCTAボタン**:
```html
<!-- プライマリCTA -->
<button class="bg-accent-orange hover:bg-accent-orange/90 text-white px-8 py-4 rounded-lg">
  詳細を見る
</button>

<!-- セカンダリCTA -->
<button class="bg-white/10 hover:bg-white/15 backdrop-blur-md text-white px-8 py-4 rounded-lg border border-white/20">
  リスケ
</button>
```

**スクロールフェードインアニメーション**:
```javascript
// IntersectionObserver使用
const observer = new IntersectionObserver(
  ([entry]) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('animate-fade-in');
    }
  },
  { threshold: 0.1 }
);
```

---

## 5. 7セクション詳細設計

### 5.1 Section 1: Critical Alerts

**目的**: 今すぐ決めないとプロジェクトが止まる情報のみ表示

**データ源**:
- NocoDB API: `ステータス = ブロック`、`期限 < 今日 && ステータス != 完了`
- Mana S3: ワークフロー成功率 < 60%

**API**: `GET /api/brainbase/critical-alerts`

**レスポンス**:
```json
{
  "alerts": [
    {
      "type": "blocker",
      "project": "salestailor",
      "task": "API認証エラー",
      "owner": "太田",
      "days_blocked": 5,
      "severity": "critical"
    }
  ],
  "total_critical": 2,
  "total_warning": 1
}
```

**UI実装**:
- カラー: `#ee4f27`（critical）、`#ff9b26`（warning）
- カードスタイル: グラスモーフィズム
- アニメーション: スクロールフェードイン

---

### 5.2 Section 2: Strategic Overview

**目的**: 週次で「どのプロジェクトに注力すべきか」を判断

**データ源**:
- NocoDB API: 全プロジェクト統計
- NocoDB履歴テーブル: トレンド計算
- _codex: RACI、戦略

**API**: `GET /api/brainbase/strategic-overview`

**レスポンス**:
```json
{
  "projects": [
    {
      "name": "brainbase",
      "health_score": 87,
      "trend": "up",
      "change": 5,
      "recommendations": ["健全。現状維持でOK"]
    }
  ],
  "bottlenecks": [
    {
      "type": "assignee_overload",
      "assignee": "川合",
      "task_count": 15,
      "recommendation": "タスク分散を推奨"
    }
  ]
}
```

**表示内容**:
1. プロジェクト優先度ランキング
2. リソース配分の適切性
3. マイルストーン進捗

---

### 5.3 Section 3: Project Health Grid

**目的**: 全プロジェクトの状態を一目で把握（異常検知）

**異常検知基準**（kpi-calculation）:
- タスク一本化率 < 90% → 警告
- RACI運用率 < 80% → 警告
- 01-05充足率 < 100% → 警告
- ブランドガイド整備率 < 100% → 警告
- Knowledge Skills有効率 < 95% → 警告

**UI実装**:
- アラート色: Critical（#ee4f27）、Warning（#ff9b26）、Healthy（#35a670）
- カードスタイル: ProductCardGrid
- レイアウト: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`

---

### 5.4 Section 4: Trend Analysis

**目的**: 「今」だけでなく「変化」を見る

**プロジェクト成熟度フレームワーク**（saas-ai-roadmap-playbook）:
- CPF (Customer/Problem Fit): 課題が存在するか
- PSF (Problem/Solution Fit): ソリューションが受け入れられるか
- SPF (Solution/Product Fit): プロダクトとして磨かれているか
- PMF (Product/Market Fit): 市場にフィットしているか

**トレンド分類**:
- 改善中: CPF→PSF→SPF→PMFのいずれかの段階が向上
- 悪化中: 段階が後退
- 安定: 同じ段階を維持

**API**: `GET /api/brainbase/trends?project_id=xxx&days=30`

**UI実装**:
- ヒートマップ: Calendar Heatmap（CPF: green, PSF: amber, SPF: purple, PMF: blue）
- トレンドグラフ: TanStack UI Table + Chart.js

---

### 5.5 Section 5: Mana Quality Dashboard

**目的**: Mana品質の可視化

**データ源**: Mana S3（ワークフロー実行履歴）

**表示内容**:
1. Mana Hero Status（CRITICAL/WARNING/HEALTHY）
2. Workflow実行状況（成功率、エラー詳細）

**UI実装**:
- Mana Hero Status Card: グラスモーフィズム
- Overall Status: CRITICAL（#ee4f27）、WARNING（#ff9b26）、HEALTHY（#35a670）
- Workflow実行状況: TestimonialCard + リスト表示

---

### 5.6 Section 6: System Health

**目的**: インフラ監視（異常時のみ表示）

**表示内容**: 現状維持、デフォルトで折りたたみ

**UI実装**:
- 折りたたみヘッダー: アコーディオン
- 異常検知時のハイライト: `border-accent-orange animate-pulse`

---

### 5.7 Section 7: Actionable Insights

**目的**: AIが意思決定案を提示

**実装時期**: Phase 3（Week 17-28）

**表示内容**:
1. 週次アクション提案
2. リソース最適化提案

**データ源**: NocoDB統計 + _codex + Mana履歴 + Claude Opus 4.5

---

## 6. データモデル

### 6.1 NocoDB履歴テーブル

#### テーブル名: `プロジェクト健全性履歴`

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `id` | Number (Auto) | 主キー |
| `project_id` | SingleLineText | プロジェクトID（zeims, salestailor等） |
| `snapshot_date` | Date | スナップショット日付 |
| `total_tasks` | Number | タスク総数 |
| `completed_tasks` | Number | 完了タスク数 |
| `overdue_tasks` | Number | 期限超過タスク数 |
| `blocked_tasks` | Number | ブロックタスク数 |
| `completion_rate` | Number | 完了率（%） |
| `milestone_progress` | Number | マイルストーン進捗率（%） |
| `health_score` | Number | 健全性スコア（0-100） |
| `created_at` | DateTime | 作成日時 |

**UNIQUE制約**: `project_id` + `snapshot_date` （1日1レコード）

**Health Score計算式**:
```javascript
healthScore = Math.round(
  (completion_rate * 0.3) +
  (overdue_score * 0.2) +      // overdue_score = max(0, 100 - overdue * 10)
  (blocked_score * 0.2) +      // blocked_score = max(0, 100 - blocked * 20)
  (milestone_progress * 0.3)
);
```

---

#### テーブル名: `Manaワークフロー履歴`

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `id` | Number (Auto) | 主キー |
| `workflow_id` | SingleLineText | ワークフローID（m1, m2, m3等） |
| `execution_date` | Date | 実行日付 |
| `success_count` | Number | 成功回数 |
| `failure_count` | Number | 失敗回数 |
| `success_rate` | Number | 成功率（%） |
| `error_details` | LongText | エラー詳細（JSON） |
| `created_at` | DateTime | 作成日時 |

**UNIQUE制約**: `workflow_id` + `execution_date` （1日1レコード）

---

## 7. API仕様

### 7.1 エンドポイント一覧

| エンドポイント | メソッド | 説明 |
|--------------|----------|------|
| `/api/brainbase/critical-alerts` | GET | Critical Alertsデータ取得 |
| `/api/brainbase/strategic-overview` | GET | Strategic Overviewデータ取得 |
| `/api/brainbase/trends` | GET | トレンドデータ取得（パラメータ: project_id, days） |
| `/api/brainbase/projects` | GET | 全プロジェクトの健全性スコア取得 |

### 7.2 `/api/brainbase/critical-alerts`

**リクエスト**: なし

**レスポンス**:
```json
{
  "alerts": [
    {
      "type": "blocker",
      "project": "salestailor",
      "task": "API認証エラー",
      "owner": "太田",
      "days_blocked": 5,
      "severity": "critical"
    },
    {
      "type": "overdue",
      "project": "zeims",
      "task": "税理士連携タスク",
      "owner": "川合",
      "days_overdue": 3,
      "severity": "warning"
    }
  ],
  "total_critical": 2,
  "total_warning": 1
}
```

### 7.3 `/api/brainbase/strategic-overview`

**リクエスト**: なし

**レスポンス**:
```json
{
  "projects": [
    {
      "name": "brainbase",
      "health_score": 87,
      "trend": "up",
      "change": 5,
      "recommendations": ["健全。現状維持でOK"]
    },
    {
      "name": "salestailor",
      "health_score": 72,
      "trend": "down",
      "change": -8,
      "recommendations": ["期限超過多数。リソース追加を検討"]
    }
  ],
  "bottlenecks": [
    {
      "type": "assignee_overload",
      "assignee": "川合",
      "task_count": 15,
      "recommendation": "タスク分散を推奨"
    }
  ]
}
```

### 7.4 `/api/brainbase/trends`

**リクエスト**:
- `project_id` (optional): プロジェクトID
- `days` (default: 30): 取得日数

**レスポンス**:
```json
{
  "project_id": "salestailor",
  "snapshots": [
    {
      "date": "2026-01-09",
      "health_score": 72,
      "completion_rate": 65
    }
  ],
  "trend_analysis": {
    "trend": "declining",
    "health_score_change": -8,
    "alert_level": "warning"
  }
}
```

---

## 8. 実装計画

### 8.1 全体タイムライン（8-12週間）

| Week | Phase | 内容 |
|------|-------|------|
| 1-2 | Phase 1 | Section 1（Critical Alerts）実装・リリース |
| 3-4 | Phase 2 | Section 2（Strategic Overview）実装・リリース |
| 5-6 | Phase 3 | Section 4（Trend Analysis）+ NocoDB履歴テーブル構築 |
| 7-8 | Phase 4 | Section 5（Mana統合）実装・リリース |
| 9-10 | Phase 5 | Section 3, 6改善・リリース |
| 11-12 | Phase 6 | 統合テスト・最適化 |

### 8.2 Week 1-2: Section 1（Critical Alerts）

**目標**: 即座の意思決定支援を実現

**実装タスク**:
1. `/api/brainbase/critical-alerts` エンドポイント実装
2. `NocoDBService.getCriticalAlerts()` メソッド追加
3. `DashboardController.renderSection1()` 実装
4. Critical Alerts UI/CSS実装

**成功指標**:
- Critical Alertsが主要ユーザーの朝のルーチンに組み込まれる
- ブロッカー解消までの平均時間が3日→1日に短縮

**Critical Files**:
- `server/routes/brainbase.js`
- `server/services/nocodb-service.js`
- `public/modules/dashboard-controller.js`
- `public/index.html`
- `public/style.css`

---

### 8.3 Week 3-4: Section 2（Strategic Overview）

**目標**: 週次の戦略的意思決定支援

**実装タスク**:
1. `/api/brainbase/strategic-overview` エンドポイント実装
2. プロジェクト優先度ランキング計算ロジック
3. リソース配分分析（_codex RACI連携）
4. Strategic Overview UI/CSS実装

**成功指標**:
- 週次会議でStrategic Overviewを活用
- プロジェクト優先順位の調整判断が迅速化

**Critical Files**:
- `server/routes/brainbase.js`
- `server/services/nocodb-service.js`
- `_codex/common/meta/raci/*.md`

---

### 8.4 Week 5-6: Section 4 + NocoDB履歴テーブル

**目標**: トレンド分析の基盤構築

**実装タスク**:
1. NocoDB履歴テーブル作成（`プロジェクト健全性履歴`）
2. GitHub Actions Cron Job実装（`daily-snapshot.yml`）
3. `/api/brainbase/trends` エンドポイント実装
4. Section 4 Trend Analysis実装

**重要**:
- 履歴データは初日から蓄積開始
- Week 5で履歴テーブル作成 → Week 6で30日分の過去データを逆算して挿入（可能なら）

**Critical Files**:
- `.github/workflows/daily-snapshot.yml`
- `scripts/daily-snapshot.js`
- `server/services/nocodb-service.js` (`insertSnapshot()`, `getTrends()`)
- `server/routes/brainbase.js`

---

### 8.5 Week 7-8: Section 5（Mana統合）

**目標**: Mana品質の可視化

**実装タスク**:
1. Mana実行履歴テーブル作成（`Manaワークフロー履歴`）
2. Mana S3からの履歴データ集計スクリプト
3. Section 5 Mana Quality Dashboard実装

**Phase 2延期項目**:
- 品質メトリクス（Usefulness等）の実装 → Phase 2（Week 13-16）に延期

**Critical Files**:
- `server/services/mana-service.js` (新規)
- `scripts/mana-snapshot.js` (新規)

---

### 8.6 Week 9-10: Section 3, 6改善

**目標**: 既存セクションの簡素化・最適化

**実装タスク**:
1. Section 3: Project Health Grid簡素化（異常検知に特化）
2. Section 6: System Health折りたたみ実装
3. Section 7のプレースホルダー実装（Phase 3で本実装）

---

### 8.7 Week 11-12: 統合テスト・最適化

**目標**: 全体の統合・パフォーマンス最適化

**実装タスク**:
1. API統合テスト
2. UI/UXレビュー
3. パフォーマンス最適化（API並列化、キャッシュ）
4. ドキュメント作成

---

## 9. 検証計画

### 9.1 Week 2（Section 1完了時）

**レバレッジ基準**:
- [ ] Critical Alertsが主要ユーザーの朝のルーチンに組み込まれる（情報提供の自動化）
- [ ] ブロッカー解消までの平均時間が3日→1日に短縮（意思決定速度の向上）
- [ ] 期限超過タスクの可視化により、リスケ判断が即座に可能（ネガティブレバレッジの削減）

**IDS基準（Identify）**:
- [ ] プロジェクトブロッカーの根本原因が即座に特定できる
- [ ] 期限超過の真因（リソース不足 or スコープ過多）が判別できる
- [ ] Mana品質低下の具体的な箇所（Workflow名、エラー率）が特定できる

---

### 9.2 Week 4（Section 2完了時）

**レバレッジ基準**:
- [ ] 週次会議でStrategic Overviewを活用（1対多の情報共有）
- [ ] プロジェクト優先順位の調整判断が迅速化（意思決定のレバレッジ向上）
- [ ] リソース配分の最適化提案が実行される（組織全体のアウトプット向上）

**IDS基準（Discuss）**:
- [ ] プロジェクト優先順位の調整時、Health Scoreトレンドを根拠に議論できる
- [ ] リソース配分の適切性（ボトルネック検出）が客観的に議論できる
- [ ] マイルストーン遅延リスクが議論の俎上に載る

**EOS基準（データモジュール）**:
- [ ] スコアカード（5〜15個のKPI）がリアルタイムで更新される
- [ ] 数値根拠に基づいた意思決定が行われる（感情・憶測ではなく）

---

### 9.3 Week 6（Trends完了時）

**レバレッジ基準**:
- [ ] トレンドグラフがリアルタイムで更新される（継続的な情報提供）
- [ ] 過去30日のHealth Scoreトレンドが表示される（時系列分析の自動化）
- [ ] トレンド分析により、悪化傾向のプロジェクトを早期検知（先行指標の活用）

**バリデーション段階判定（saas-ai-roadmap-playbook）**:
- [ ] プロジェクト成熟度（CPF/PSF/SPF/PMF）が可視化される
- [ ] 改善中/悪化中/安定の分類が自動判定される
- [ ] バリデーション段階の推移がヒートマップで確認できる

---

### 9.4 Week 12（Phase 1完了時）

**レバレッジ基準（最終目標）**:
- [ ] 全7セクションが実装完了
- [ ] 主要ユーザーのダッシュボード利用時間が1日30分→10分に短縮（レバレッジ3倍達成）
- [ ] 意思決定の速度が向上（ブロッカー解消1日、戦略調整週次）

**IDS基準（フルサイクル）**:
- [ ] Identify: Critical Alertsで問題を即座に特定
- [ ] Discuss: Strategic Overviewで選択肢を議論
- [ ] Solve: Actionable Insights（Phase 3）で最善策を決定

**EOS基準（データモジュール完成）**:
- [ ] スコアカード（全プロジェクト）が毎週更新される
- [ ] 先行指標（5〜15個のKPI）を毎週追跡
- [ ] 数値に基づいた客観的な経営判断が習慣化

**組織レバレッジ（manager-leverage）**:
- [ ] ダッシュボードが主要ユーザーの組織（Unson/Tech Knight/BAAO/SalesTailor）全体のアウトプット向上に寄与
- [ ] 隣接組織（他プロジェクトメンバー）への情報提供も実現
- [ ] 人間は「判断」と「例外対応」のみに集中（ルーチンはAI自動化）

---

## 10. 今後の拡張計画

### 10.1 Phase 2（Week 13-16）: Mana品質メトリクス実装

**実装内容**:
1. Mana S3からの品質データ収集
2. 品質スコア計算（Usefulness/Accuracy/Conciseness/Tone）
3. Section 5の品質メトリクス実データ化

**データ源**:
- S3バケット: `brainbase-context-593793022993/mana-quality/`
- ユーザーフィードバック: Slack thumbs up/down
- 自動評価: Claude Opus 4.5による品質評価

---

### 10.2 Phase 3（Week 17-28）: AI提案エンジン

**実装内容**:
1. Section 7: Actionable Insights実装（Claude Opus 4.5）
2. リソース最適化エンジン
3. 自動アクション提案

**目標**:
- AI提案の採用率が50%以上
- 週次会議時間が30分→15分に短縮
- 人間は例外対応のみに集中

---

## 11. 参考資料

### 11.1 関連ドキュメント

- `docs/dashboard-implementation-prompt.md`: 既存実装プロンプト
- `docs/dashboard-wireframe.md`: 既存ワイヤーフレーム
- `docs/REFACTORING_PLAN.md`: リファクタリング計画

### 11.2 Skills参照

| Skill | 内容 |
|-------|------|
| `manager-leverage` | レバレッジ3倍、1対多の情報提供 |
| `ui-design-resources` | shadcn/ui、n8n型ダークテーマ、グラスモーフィズム |
| `kpi-calculation` | タスク一本化率90%、RACI運用率80%、Skills有効率95% |
| `saas-ai-roadmap-playbook` | CPF→PSF→SPF→PMF |
| `leadership-frameworks` | EOS 6モジュール、IDS（Identify/Discuss/Solve） |

---

## 12. まとめ

**核心哲学**: 人間は「判断」と「例外対応」のみに集中。ルーチンはAIが自動化。

**技術選択**: NocoDB履歴テーブル（セットアップ簡単、既存インフラ活用）

**実装順序**: Critical Alerts → Strategic Overview → Trend Analysis → Mana統合 → 最適化

**成功指標**: ブロッカー解消時間短縮、週次会議時間短縮、意思決定速度向上

---

**作成者**: brainbase development team
**レビューア**: レビュー担当者
**承認日**: 未定
**次回レビュー**: Week 2（Section 1完了時）
