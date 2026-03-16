# brainbase 運用ダッシュボード - 実装プロンプト（Phase 1）

**作成日**: 2025-12-31
**対象**: AI開発アシスタント（Claude / Cursor / その他）
**目的**: brainbase監視ダッシュボードのフロントエンド実装（Phase 1）

---

## 1. 背景と目的

### 解決したい課題

現在、佐藤（経営者）が朝一番に各ツール（Slack、Airtable、GitHub Actions）を30分かけて巡回しています。**朝5分で全プロジェクトの健全性を把握し、今日すべきことを判断できるダッシュボード**を作成してください。

### やりたいこと

```
[7:00] ダッシュボード開く
[7:01] ↓ 赤く光っているプロジェクトを発見
       「DialogAI: 健全性スコア45点、期限超過8件」
[7:02] ↓ 問題箇所を特定
[7:03] ↓ 推奨アクション確認
       「緊急MTG招集、ブロック解除支援」
[7:05] 判断完了 → Slackで指示
```

---

## 2. 実装範囲（Phase 1）

今回実装するのは以下の3セクション：

### Section 1: 健全性ゲージ（4つ）
- 上位4プロジェクトの健全性スコアを半円ゲージで表示
- 色分け（🟢緑70-100、🟡黄50-69、🔴赤0-49）

### Section 2: サマリーダッシュボード
- **左**: 主要メトリクス4つ（タスク総数、期限超過、完了率、ブロック）
- **中央**: 全体健全性ドーナツチャート
- **右**: 問題プロジェクト2つのドーナツチャート

### Section 3: プロジェクトカードグリッド
- 12プロジェクトを4列×3行のカードグリッドで表示
- 各カードに健全性スコア、プロジェクト名、期限超過件数

**Phase 2以降**（今回は実装しない）:
- Section 4: ヒートマップ（時系列）
- Section 5: システムリソースゲージ
- Section 6: トレンドグラフ

---

## 3. 技術スタック

### 必須技術
- **HTML**: 既存の `public/index.html` に統合
- **CSS**: `public/style.css` にスタイル追加（modern-saas-design-patternsに準拠）
- **JavaScript**: Vanilla JS（既存の `public/modules/` 構造に準拠）
- **チャートライブラリ**: Recharts（CDN経由で読み込み）
- **アイコン**: Lucide icons（既存で使用中）

### 禁止事項
- ❌ React / Vue / Angular などのフレームワーク導入
- ❌ TypeScript導入（既存コードベースがVanilla JS）
- ❌ npm パッケージの新規追加（CDN経由のみ可）

---

## 4. 既存コードベース

### プロジェクト構造

```
/Users/ksato/workspace/projects/brainbase/
├── public/
│   ├── index.html                    ← HTML追加
│   ├── style.css                     ← スタイル追加
│   ├── app.js                        ← 初期化処理追加
│   └── modules/
│       ├── core/
│       │   └── http-client.js        ← 既存（使用可）
│       └── domain/
│           └── brainbase/
│               └── brainbase-service.js  ← 既存（使用可）
├── server.js                         ← サーバー（既に稼働中）
└── docs/
    └── docs/projects/aitm/dashboard-wireframe.md  ← 詳細仕様（必読）
```

### 既存のAPI（利用可能）

**エンドポイント**: `GET /api/brainbase`

**レスポンス構造**:
```json
{
  "github": {
    "runners": {
      "total": 1,
      "online": 0,
      "runners": [...]
    },
    "workflows": {...}
  },
  "system": {
    "cpu": { "usage": 67.92, "cores": 12 },
    "memory": { "usage": 99.89, "total": "24 GB" },
    "disk": { "usage": 85, "size": "460Gi" }
  },
  "tasks": {
    "total": 121,
    "completed": 0,
    "pending": 0,
    "overdue": 8,
    "blocked": 3,
    "completionRate": 85
  },
  "worktrees": {
    "total": 44,
    "active": 43
  },
  "storage": {
    "workspace": {
      "workspace": { "size": "55G" },
      "worktrees": { "size": "3.1G" }
    }
  }
}
```

**既存サービスクラス**:
```javascript
// public/modules/domain/brainbase/brainbase-service.js
import { HttpClient } from '../../core/http-client.js';

export class BrainbaseService {
  async getAllData() {
    return this.httpClient.get('/api/brainbase');
  }
}
```

---

## 5. 実装手順

### Step 1: ワイヤーフレーム確認

**必読**: `/Users/ksato/workspace/projects/brainbase/docs/projects/aitm/dashboard-wireframe.md`

特に以下のセクションを熟読：
- Section 1-3の詳細仕様
- コンポーネント一覧
- カラーシステム
- データフロー（健全性スコア計算ロジック）

### Step 2: HTML構造追加

`public/index.html` に以下の構造を追加：

```html
<!-- 既存のmain-content内に追加 -->
<div class="main-panel" id="dashboard-panel">
  <div class="dashboard-container">
    <!-- Section 1: 健全性ゲージ（4つ） -->
    <section class="health-gauges">
      <div id="gauge-1" class="gauge-chart"></div>
      <div id="gauge-2" class="gauge-chart"></div>
      <div id="gauge-3" class="gauge-chart"></div>
      <div id="gauge-4" class="gauge-chart"></div>
    </section>

    <!-- Section 2: サマリーダッシュボード -->
    <section class="summary-dashboard">
      <div class="metrics-left">
        <!-- 主要メトリクス4つ -->
      </div>
      <div class="donut-center">
        <!-- 全体健全性ドーナツ -->
      </div>
      <div class="donuts-right">
        <!-- 問題プロジェクト2つ -->
      </div>
    </section>

    <!-- Section 3: プロジェクトカードグリッド -->
    <section class="project-cards-grid">
      <!-- 12プロジェクトカード -->
    </section>
  </div>
</div>
```

### Step 3: CSS実装

`public/style.css` にスタイルを追加：

**カラーシステム**（必須）:
```css
:root {
  /* 健全性スコア */
  --health-excellent: #35a670;  /* 緑（70-100点） */
  --health-warning: #ff9b26;    /* 黄（50-69点） */
  --health-danger: #ee4f27;     /* 赤（0-49点） */

  /* 背景（ダークテーマ） */
  --bg-primary: #0e0918;
  --bg-secondary: #1f192a;
  --bg-card: #1b1728;
  --bg-overlay: rgba(255, 255, 255, 0.05);

  /* テキスト */
  --text-primary: #c4bbd3;
  --text-secondary: #6f87a0;
  --text-white: #ffffff;
}
```

**レスポンシブグリッド**:
```css
.health-gauges {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 32px;
}

@media (max-width: 1200px) {
  .health-gauges {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .health-gauges {
    grid-template-columns: 1fr;
  }
}
```

**グラスモーフィズムカード**:
```css
.project-card {
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.08), transparent);
  backdrop-filter: blur(30px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 24px;
  transition: all 0.3s ease;
}

.project-card:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: scale(1.02);
}
```

### Step 4: JavaScript実装

#### 4-1. コンポーネント作成

**`public/modules/components/gauge-chart.js`** （新規作成）:
```javascript
export class GaugeChart {
  constructor(container, options = {}) {
    this.container = container;
    this.value = options.value || 0;
    this.label = options.label || '';
    this.color = this.getColor(this.value);
    this.render();
  }

  getColor(value) {
    if (value >= 70) return '#35a670'; // 緑
    if (value >= 50) return '#ff9b26'; // 黄
    return '#ee4f27'; // 赤
  }

  render() {
    // Canvas API で半円ゲージを描画
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    this.container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    this.drawGauge(ctx);
  }

  drawGauge(ctx) {
    const centerX = 80;
    const centerY = 100;
    const radius = 70;
    const startAngle = Math.PI;
    const endAngle = 2 * Math.PI;
    const valueAngle = startAngle + (endAngle - startAngle) * (this.value / 100);

    // 背景円弧（グレー）
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.stroke();

    // 値円弧（色付き）
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, valueAngle);
    ctx.lineWidth = 12;
    ctx.strokeStyle = this.color;
    ctx.stroke();

    // 中央テキスト（スコア）
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(this.value, centerX, centerY - 10);

    // ラベル
    ctx.fillStyle = '#6f87a0';
    ctx.font = '14px Inter';
    ctx.fillText(this.label, centerX, centerY + 40);
  }
}
```

**`public/modules/components/donut-chart.js`** （新規作成）:
```javascript
// Recharts CDN を使用してドーナツチャート実装
// index.html に以下を追加:
// <script src="https://unpkg.com/recharts@2.5.0/dist/Recharts.js"></script>
// <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
// <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>

export class DonutChart {
  constructor(container, options = {}) {
    this.container = container;
    this.value = options.value || 0;
    this.label = options.label || '';
    this.color = this.getColor(this.value);
    this.render();
  }

  getColor(value) {
    if (value >= 70) return '#35a670';
    if (value >= 50) return '#ff9b26';
    return '#ee4f27';
  }

  render() {
    // SVGでシンプルなドーナツチャートを描画
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '280');
    svg.setAttribute('height', '280');
    svg.setAttribute('viewBox', '0 0 280 280');

    const radius = 100;
    const strokeWidth = 20;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (this.value / 100) * circumference;

    // 背景円
    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', '140');
    bgCircle.setAttribute('cy', '140');
    bgCircle.setAttribute('r', radius);
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', 'rgba(255, 255, 255, 0.1)');
    bgCircle.setAttribute('stroke-width', strokeWidth);

    // 値円
    const valueCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    valueCircle.setAttribute('cx', '140');
    valueCircle.setAttribute('cy', '140');
    valueCircle.setAttribute('r', radius);
    valueCircle.setAttribute('fill', 'none');
    valueCircle.setAttribute('stroke', this.color);
    valueCircle.setAttribute('stroke-width', strokeWidth);
    valueCircle.setAttribute('stroke-dasharray', circumference);
    valueCircle.setAttribute('stroke-dashoffset', offset);
    valueCircle.setAttribute('transform', 'rotate(-90 140 140)');

    // 中央テキスト
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '140');
    text.setAttribute('y', '150');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('font-size', '48');
    text.setAttribute('font-weight', 'bold');
    text.textContent = `${this.value}%`;

    svg.appendChild(bgCircle);
    svg.appendChild(valueCircle);
    svg.appendChild(text);
    this.container.appendChild(svg);
  }
}
```

**`public/modules/components/project-card.js`** （新規作成）:
```javascript
export class ProjectCard {
  constructor(container, project) {
    this.container = container;
    this.project = project;
    this.render();
  }

  getColor(score) {
    if (score >= 70) return '#35a670';
    if (score >= 50) return '#ff9b26';
    return '#ee4f27';
  }

  render() {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-card-score" style="color: ${this.getColor(this.project.healthScore)}">
        ${this.project.healthScore}%
      </div>
      <div class="project-card-name">${this.project.name}</div>
      <div class="project-card-overdue" style="color: #ee4f27">
        ${this.project.overdue} 超過
      </div>
    `;
    card.addEventListener('click', () => this.showDetails());
    this.container.appendChild(card);
  }

  showDetails() {
    // プロジェクト詳細モーダル表示（Phase 2で実装）
    console.log('Project details:', this.project);
  }
}
```

#### 4-2. ダッシュボード初期化

**`public/modules/dashboard-controller.js`** （新規作成）:
```javascript
import { BrainbaseService } from './domain/brainbase/brainbase-service.js';
import { GaugeChart } from './components/gauge-chart.js';
import { DonutChart } from './components/donut-chart.js';
import { ProjectCard } from './components/project-card.js';

export class DashboardController {
  constructor() {
    this.brainbaseService = new BrainbaseService();
    this.data = null;
    this.projects = [];
  }

  async init() {
    await this.loadData();
    this.renderSection1();
    this.renderSection2();
    this.renderSection3();
  }

  async loadData() {
    this.data = await this.brainbaseService.getAllData();
    this.projects = this.calculateProjectHealth();
  }

  calculateProjectHealth() {
    // 12プロジェクトの健全性スコアを計算
    // 注: 実際のプロジェクトデータは今後APIから取得
    // 今はダミーデータで実装
    const projectNames = [
      'brainbase', 'TechKnight', 'DialogAI', 'ZEIMS',
      'BAAO', 'UNSON', 'SalesTailor', 'AI-Wolf',
      'Mana', 'Portfolio', 'Catalyst', 'NCom'
    ];

    return projectNames.map(name => ({
      name,
      healthScore: this.calculateScore(name),
      overdue: Math.floor(Math.random() * 10),
      blocked: Math.floor(Math.random() * 5),
      completionRate: Math.floor(Math.random() * 40) + 60
    })).sort((a, b) => b.healthScore - a.healthScore);
  }

  calculateScore(projectName) {
    // ダミーロジック（実際はAPIデータから計算）
    if (projectName === 'DialogAI') return 45;
    if (projectName === 'SalesTailor') return 62;
    return Math.floor(Math.random() * 30) + 70;
  }

  renderSection1() {
    // 上位4プロジェクトの健全性ゲージ
    const topProjects = this.projects.slice(0, 4);
    topProjects.forEach((project, index) => {
      const container = document.getElementById(`gauge-${index + 1}`);
      new GaugeChart(container, {
        value: project.healthScore,
        label: project.name
      });
    });
  }

  renderSection2() {
    // メトリクス（左）
    // ドーナツチャート（中央＋右）
    const overallScore = Math.round(
      this.projects.reduce((sum, p) => sum + p.healthScore, 0) / this.projects.length
    );

    const centerContainer = document.querySelector('.donut-center');
    new DonutChart(centerContainer, {
      value: overallScore,
      label: '全体健全性'
    });

    // 問題プロジェクト2つ（健全性スコアが最も低い）
    const problemProjects = this.projects.slice(-2).reverse();
    const rightContainer = document.querySelector('.donuts-right');
    problemProjects.forEach(project => {
      const div = document.createElement('div');
      rightContainer.appendChild(div);
      new DonutChart(div, {
        value: project.healthScore,
        label: project.name
      });
    });
  }

  renderSection3() {
    // 12プロジェクトカードグリッド
    const gridContainer = document.querySelector('.project-cards-grid');
    this.projects.forEach(project => {
      new ProjectCard(gridContainer, project);
    });
  }
}
```

**`public/app.js`** に初期化コード追加:
```javascript
import { DashboardController } from './modules/dashboard-controller.js';

class App {
  async init() {
    // ... 既存の初期化 ...

    // ダッシュボード初期化
    this.dashboardController = new DashboardController();
    await this.dashboardController.init();
  }
}
```

---

## 6. 検証方法

### 動作確認手順

1. **サーバー起動**:
   ```bash
   cd /Users/ksato/workspace/projects/brainbase
   npm run dev
   ```
   → `http://localhost:3000` でアクセス

2. **Section 1確認**:
   - 4つの半円ゲージが表示される
   - 各ゲージに健全性スコアとプロジェクト名
   - 色が正しい（緑/黄/赤）

3. **Section 2確認**:
   - 左: タスク総数、期限超過、完了率、ブロックが表示
   - 中央: 全体健全性ドーナツチャート
   - 右: 問題プロジェクト2つのドーナツチャート

4. **Section 3確認**:
   - 12プロジェクトカードが4列×3行で表示
   - 各カードに健全性スコア、プロジェクト名、期限超過件数
   - カードをホバーすると拡大（scale 1.02）
   - カードをクリックするとコンソールにログ出力

5. **レスポンシブ確認**:
   - ブラウザ幅を810px以下に縮小 → 2列表示
   - ブラウザ幅を640px以下に縮小 → 1列表示

### ビジュアル確認

**期待される見た目**:
- ダークテーマ（背景 `#0e0918`）
- グラスモーフィズム効果（カードが半透明でぼかし）
- 健全性スコアが色分けされている
- アニメーションがスムーズ（0.3秒）

---

## 7. 制約条件

### 必須ルール
- ✅ **日本語**でコメント・ラベル記述
- ✅ **既存の構造**を壊さない（`public/modules/` パターンに準拠）
- ✅ **modern-saas-design-patterns**のカラーシステムを使用
- ✅ **レスポンシブ対応**（モバイル/タブレット/デスクトップ）
- ✅ **アクセシビリティ**（色コントラスト4.5:1以上）

### 禁止事項
- ❌ 既存ファイルの削除
- ❌ サーバー側コード（`server.js`）の変更
- ❌ npm パッケージの新規追加（CDN のみ可）
- ❌ TypeScript / JSX の使用

---

## 8. 成果物

Phase 1完了時に以下が動作する状態：

### ファイル一覧

**新規作成**:
- `public/modules/components/gauge-chart.js`
- `public/modules/components/donut-chart.js`
- `public/modules/components/project-card.js`
- `public/modules/dashboard-controller.js`

**更新**:
- `public/index.html`（HTML構造追加）
- `public/style.css`（スタイル追加）
- `public/app.js`（初期化処理追加）

### 動作する機能
- ✅ Section 1: 健全性ゲージ（4つ）表示
- ✅ Section 2: サマリーダッシュボード表示
- ✅ Section 3: プロジェクトカードグリッド（12個）表示
- ✅ レスポンシブ対応
- ✅ ホバーエフェクト

---

## 9. 参考資料

### 必読ドキュメント
1. **ワイヤーフレーム詳細**: `/Users/ksato/workspace/projects/brainbase/docs/projects/aitm/dashboard-wireframe.md`
2. **デザインパターン**: `.claude/skills/modern-saas-design-patterns/`（カラーシステム、コンポーネント）

### 参考画像
ユーザー提供のダッシュボード参考画像（ビジュアルイメージ参考）

### 既存コード
- `public/modules/core/http-client.js`（HTTP通信）
- `public/modules/domain/brainbase/brainbase-service.js`（API呼び出し）
- `public/style.css`（既存スタイル参考）

---

## 10. よくある質問

### Q1: プロジェクトデータはどこから取得？
**A**: 現時点では `/api/brainbase` から取得できるのは `tasks`, `system`, `github` などの統合データのみ。プロジェクト別データは今後API拡張予定のため、**Phase 1ではダミーデータ**で実装してください。

### Q2: Recharts が読み込めない場合は？
**A**: CDN版が動作しない場合、Canvas API や SVG で自作してください。参考実装を `DonutChart` クラスに含めています。

### Q3: アニメーションは必須？
**A**: Phase 1では**ホバーエフェクトのみ必須**。ゲージやドーナツチャートのアニメーションはPhase 4で実装予定。

### Q4: モバイル対応はどこまで？
**A**: Phase 1では**レスポンシブグリッド**（1列/2列/4列の切り替え）のみ。タッチ操作やモバイル専用UIはPhase 4。

---

## 11. 実装開始

上記の指示に従って、Phase 1の実装を開始してください。

**最初のステップ**:
1. ワイヤーフレームを熟読
2. HTML構造を追加
3. CSS実装（カラーシステム、グリッド）
4. JavaScript実装（GaugeChart → DonutChart → ProjectCard の順）
5. 動作確認

**質問があれば**: ワイヤーフレームドキュメントを再確認してください。

---

最終更新: 2025-12-31
