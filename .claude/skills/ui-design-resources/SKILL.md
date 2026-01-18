---
name: ui-design-resources
description: UI/UXデザインリソース統合ガイド（2 Skills統合版）。shadcn/uiエコシステム全体（コンポーネント・テンプレート・ツール）とモダンSaaS/AIプラットフォームのデザインパターン（カラーシステム・タイポグラフィ・レイアウト・コンポーネント実装）を統合した実践ガイド
---

**バージョン**: v2.0（2 Skills統合版）
**実装日**: 2025-12-30
**統合済みSkills**: 2個
**統合後サイズ**: 約1,100行 ✅ OPTIMAL範囲（1000-3000行）

---

## 統合Skills一覧

| # | 元Skill名 | 行数 | 主要内容 |
|---|----------|------|---------|
| 1 | shadcn-ui-resources | 192行 | shadcn/ui関連の全リソース網羅（アニメーション・テンプレート・ツール） |
| 2 | modern-saas-design-patterns | 702行 | モダンSaaS/AIプラットフォームのデザインパターン（カラー・タイポ・コンポーネント） |

---

## Triggers（このSkillを使うタイミング）

以下の状況で使用：

**shadcn/uiエコシステム関連**:
- モダンなランディングページのUIを設計するとき
- shadcn/ui互換のアニメーションコンポーネントを探すとき
- 管理画面やダッシュボードのテンプレートが必要なとき
- リッチテキストエディタやカレンダーなど特殊コンポーネントを実装するとき

**モダンSaaSデザインパターン関連**:
- SaaS/AIプラットフォームのLP設計時
- ダークテーマUIの実装時
- マルチエージェント/自動化ツールのUI設計時
- デュアルCTA戦略の実装時
- プロダクトカードレイアウトの設計時

---

# Quick Reference

## 状況別クイックガイド

| 状況 | 参照セクション | キーリソース |
|------|-------------|-------------|
| インパクトのあるLPを作りたい | § 1.1, § 2.4.1 | Aceternity UI + Hero Section パターン |
| 管理画面を構築したい | § 1.2, § 2.3 | Shadboard + 12カラムグリッド |
| ダークテーマUIを実装したい | § 2.1.1 | n8n型カラーパレット + グラスモーフィズム |
| AIチャットUIが必要 | § 1.6.1 | Druid/UI + Assistant UI |
| エディタを実装したい | § 1.3 | Novel (Notion-style) + Plate (AI搭載) |
| カレンダー機能が必要 | § 1.4.2 | Big Calendar + Shadcn Event Calendar |
| データテーブルが必要 | § 1.4.1 | TanStack UI Table |
| アニメーション追加したい | § 1.1, § 2.5 | Magic UI + スクロールフェードイン |
| テスティモニアル表示 | § 2.4.4 | TestimonialCard パターン |
| カスタマーロゴ表示 | § 2.4.3 | CustomerLogoMarquee パターン |

---

## 思考フレームワーク連携

### § 1（shadcn/uiエコシステム）× § 2（モダンSaaSデザインパターン）

**統合活用パターン**:
```
UI実装タスク → 「どのリソースとパターンを組み合わせるか?」

【例1】ランディングページ作成
§ 1.1 Aceternity UI（アニメーション）
  ↓
§ 2.4.1 Hero Section パターン（実装テンプレート）
  ↓
§ 2.1 カラーシステム（配色決定）

【例2】管理ダッシュボード作成
§ 1.2 Shadboard（テンプレート）
  ↓
§ 2.3 12カラムグリッド（レイアウト）
  ↓
§ 1.4.1 TanStack UI Table（データ表示）
```

**思考パターン**:
```
UI要件を受け取る → 「shadcn/uiのリソースで解決できるか?」
リソースが見つかった → 「モダンSaaSパターンでカスタマイズできるか?」
両方を組み合わせる → 「統合実装パターンはあるか?」
```

---

# § 1. shadcn/uiエコシステム

> **出典**: [awesome-shadcn-ui](https://github.com/birobirobiro/awesome-shadcn-ui)

## 1.1 アニメーション・コンポーネントライブラリ（最重要）

### 三大ライブラリ

| ライブラリ | URL | 特徴 | 用途 |
|-----------|-----|------|------|
| **Aceternity UI** | https://ui.aceternity.com/ | マジックエフェット特化 | インパクトのあるランディングページ |
| **Magic UI** | https://magicui.design/ | 150+アニメーションコンポーネント | 視覚的に美しいマーケティングサイト |
| **Cult UI** | https://www.cultui.com/ | キュレーション済みアニメーション | モダンなWebアプリ |

**思考パターン**:
```
ランディングページのインパクトが必要 → Aceternity UI
アニメーションの種類を豊富に使いたい → Magic UI
シンプルでモダンなWebアプリ → Cult UI
```

### その他アニメーションライブラリ

- **Berlix** - Tailwind CSS + Motion
- **Dy-Comps** - shadcn/ui + Framer Motion
- **Eldora UI** - React + TypeScript + Framer Motion
- **Extended UI** - 再利用可能コンポーネント集
- **Blocks.so** - クリーンでモダンなビルディングブロック
- **Launch UI** - ランディングページコンポーネント

**使い分けガイド**:
```
Framer Motion統合が必要 → Dy-Comps or Eldora UI
TypeScript必須 → Eldora UI
クリーンなデザイン → Blocks.so
ランディングページ特化 → Launch UI
```

---

## 1.2 テンプレート・管理画面

### 管理ダッシュボード

| テンプレート | 技術スタック | 特徴 |
|-------------|-------------|------|
| **Shadcn Admin** | Vite | 管理画面UI |
| **Next Shadcn Dashboard Starter** | Next.js 14 | 管理ダッシュボード |
| **Shadboard** | Next.js 15 + React 19 | 最新スタック対応 |

**思考パターン**:
```
最新技術スタック（Next.js 15） → Shadboard
Next.js 14で安定性重視 → Next Shadcn Dashboard Starter
Viteで軽量構成 → Shadcn Admin
```

### ランディングページテンプレート

- **shadcnblocks.com** - 有料・無料テンプレート
- **shadcntemplates.com** - テンプレート集
- **shadcnuikit.com** - UIキット・テンプレート

**選択基準**:
```
予算あり・高品質 → shadcnblocks.com（有料）
無料で始めたい → shadcnblocks.com（無料版）
多様性を求める → shadcntemplates.com
包括的なUIキット → shadcnuikit.com
```

---

## 1.3 リッチテキスト・エディタ

| エディタ | 特徴 | 用途 |
|---------|------|------|
| **Novel** | Notion-style WYSIWYG + AI自動補完 | ブログ・CMS |
| **Echo Editor** | TipTap + shadcn/ui | モダンエディタ |
| **Plate** | AI搭載リッチテキストフレームワーク | 高度な編集機能 |

**思考パターン**:
```
Notion風のエディタが必要 → Novel（AI自動補完付き）
シンプルなエディタ → Echo Editor
高度なカスタマイズ・AI機能 → Plate
```

**実装例（Novel）**:
```tsx
import { Editor } from 'novel';

export default function MyEditor() {
  return (
    <Editor
      defaultValue={{
        type: 'doc',
        content: [],
      }}
      onUpdate={(editor) => {
        const json = editor.getJSON();
        // 保存処理
      }}
    />
  );
}
```

---

## 1.4 データテーブル・カレンダー

### 1.4.1 データテーブル

| テーブル | 特徴 | 推奨用途 |
|---------|------|---------|
| **Shadcn Table V2** | サーバーサイド機能付き | カスタマイズ可能な管理画面 |
| **TanStack UI Table** | @tanstack/table使用 | 高度なフィルタ・ソート機能 |

**思考パターン**:
```
サーバーサイドページング必須 → Shadcn Table V2
高度なフィルタ・ソート → TanStack UI Table
シンプルなテーブル → Shadcn Table V2
```

**実装例（TanStack UI Table）**:
```tsx
import { useReactTable, getCoreRowModel } from '@tanstack/react-table';

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
});
```

### 1.4.2 カレンダー・スケジューリング

| カレンダー | 特徴 | 推奨用途 |
|----------|------|---------|
| **Big Calendar** | 複数ビュー対応 | スケジュール管理アプリ |
| **Shadcn Calendar Heatmap** | ヒートマップ表示 | アクティビティ可視化 |
| **Shadcn Event Calendar** | Google Calendar風 | イベント管理 |

**思考パターン**:
```
月・週・日ビュー切り替え必要 → Big Calendar
コミット数・活動量表示 → Shadcn Calendar Heatmap
イベント予約システム → Shadcn Event Calendar
```

---

## 1.5 フォーム・入力コンポーネント

| コンポーネント | 機能 | 技術 |
|--------------|------|------|
| **Auto Form** | Zodスキーマから自動生成 | Zod + shadcn/ui |
| **Shadcn Builder** | フォームビルダー | React生成 |
| **File Uploader** | ファイルアップロード | react-dropzone |
| **Capture Photo** | カメラ機能 | ブラウザAPI |

**思考パターン**:
```
フォームを自動生成したい → Auto Form（Zod定義から生成）
ビジュアルでフォーム作成 → Shadcn Builder
ファイルアップロード必須 → File Uploader
カメラ撮影機能 → Capture Photo
```

**実装例（Auto Form）**:
```tsx
import { z } from 'zod';
import AutoForm from '@autoform/react';

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

<AutoForm schema={schema} onSubmit={(data) => console.log(data)} />
```

---

## 1.6 特殊コンポーネント

### 1.6.1 チャット・AI

| コンポーネント | 特徴 | 推奨用途 |
|--------------|------|---------|
| **Shadcn Chat** | カスタマイズ可能 | シンプルなチャット |
| **Druid/UI** | Intercom風 | AIチャットボット |
| **Assistant UI** | AI会話インターフェース | 高度なAI対話 |

**思考パターン**:
```
シンプルなチャット → Shadcn Chat
カスタマーサポート風 → Druid/UI（Intercom風）
AI会話システム → Assistant UI
```

**実装例（Druid/UI）**:
```tsx
import { ChatWidget } from '@druidui/chat';

<ChatWidget
  messages={messages}
  onSendMessage={(msg) => handleMessage(msg)}
  theme="dark"
/>
```

### 1.6.2 プロジェクト管理

- **Kanban Board** - 本番環境対応のカンバンボード（React + Tailwind）

**思考パターン**:
```
タスク管理・カンバン必要 → Kanban Board
ドラッグ&ドロップ実装 → Kanban Board（react-beautiful-dnd使用）
```

---

## 1.7 デザインシステム・テーマ

| テーマ | 特徴 | URL |
|-------|------|-----|
| **Mynaui** | Figma + React UIキット | https://mynaui.com/ |
| **Glasscn UI** | グラスモーフィズム | - |
| **Matsu Theme** | ジブリ風テーマ | - |

**思考パターン**:
```
Figmaデザインと連携 → Mynaui
グラスモーフィズムUI → Glasscn UI
独特なテーマ性 → Matsu Theme（ジブリ風）
```

---

## 1.8 開発ツール・レジストリ

| ツール | 機能 | URL |
|-------|------|-----|
| **21st.dev** | npmレジストリ（公開可能） | https://21st.dev/ |
| **8bitcn.com** | レトロデザイン配布 | https://8bitcn.com/ |
| **Shadcn Studio** | オープンソースレジストリ | - |
| **v0.dev** | AI駆動UIジェネレーター | https://v0.dev/ |

**思考パターン**:
```
カスタムコンポーネントを公開 → 21st.dev
レトロデザインが必要 → 8bitcn.com
AIでUI生成 → v0.dev
```

---

## 1.9 用途別推奨リソース

### 用途：ランディングページ（インパクト重視）

1. **Aceternity UI** - マジックエフェクト
2. **Magic UI** - 洗練されたアニメーション
3. **shadcnblocks.com** - 既製テンプレート

**実装フロー**:
```
1. shadcnblocks.comでテンプレート選定
2. Aceternity UIでマジックエフェクト追加
3. Magic UIでアニメーション強化
```

### 用途：管理画面・ダッシュボード

1. **Shadboard** (Next.js 15 + React 19)
2. **Next Shadcn Dashboard Starter**
3. **TanStack UI Table** (データテーブル)

**実装フロー**:
```
1. Shadboardでベーステンプレート構築
2. TanStack UI Tableでデータ表示
3. shadcn/ui標準コンポーネントで機能追加
```

### 用途：コンテンツ管理・ブログ

1. **Novel** (Notion-style エディタ)
2. **Plate** (AI搭載エディタ)
3. **Auto Form** (フォーム自動生成)

**実装フロー**:
```
1. Novelでエディタ実装
2. Auto FormでZodスキーマからフォーム生成
3. Plateで高度な編集機能追加（必要に応じて）
```

### 用途：AIチャット・カスタマーサポート

1. **Druid/UI** (Intercom風)
2. **Assistant UI** (AI会話UI)
3. **Shadcn Chat** (カスタマイズ可能)

**実装フロー**:
```
1. Druid/UIでベースUI構築
2. Assistant UIでAI会話ロジック実装
3. Shadcn Chatでカスタマイズ
```

### 用途：プロジェクト管理・タスク管理

1. **Kanban Board**
2. **Shadcn Event Calendar**
3. **Big Calendar**

**実装フロー**:
```
1. Kanban Boardでタスク管理
2. Big Calendarでスケジュール表示
3. Shadcn Event Calendarでイベント管理
```

---

## 1.10 技術スタック別フィルタ

### Next.js 14/15 対応

- **Shadboard** (Next.js 15 + React 19)
- **Next Shadcn Dashboard Starter** (Next.js 14)
- **Novel** (Next.js対応)

**思考パターン**:
```
Next.js 15最新機能使用 → Shadboard
Next.js 14で安定性重視 → Next Shadcn Dashboard Starter
```

### Vite 対応

- **Shadcn Admin** (Vite)

**思考パターン**:
```
軽量・高速ビルド必須 → Shadcn Admin（Vite）
```

### Figma連携

- **Mynaui** (Figma + React)
- **shadcndesign.com** (Figma plugin)

**思考パターン**:
```
Figmaデザインをコード化 → Mynaui or shadcndesign.com
```

---

## 1.11 awesome-shadcn-ui 公式リンク

**GitHub**: https://github.com/birobirobiro/awesome-shadcn-ui

このリポジトリは常に更新されており、最新のshadcn/ui関連リソースが追加されています。

**活用方法**:
- 月1回チェックして新規リソース確認
- Star・Watchで更新通知受け取り
- PRで新規リソース提案可能

---

# § 2. モダンSaaSデザインパターン

> **出典**: Relevance AI、Beam AI、n8nの3つの先進的なSaaS/AIプラットフォームから抽出

## 2.1 カラーシステム

### 2.1.1 ダークテーマパレット（n8n型）

```typescript
// Tailwind CSS設定
const colors = {
  // 背景色
  background: {
    navy: {
      midnight: '#0e0918',  // プライマリ背景
      deep: '#1f192a',      // セカンダリ背景
      dark: '#1b1728',      // カード背景
    },
    subtle: '#141020',
  },

  // テキスト色
  text: {
    primary: '#c4bbd3',    // ラベンダーグレー（高可読性）
    secondary: '#6f87a0',  // パラグラフ用
    tertiary: '#7a7a7a',   // キャプション用
  },

  // アクセント色
  accent: {
    orange: '#ee4f27',     // プライマリCTA
    amber: '#ff9b26',      // セカンダリCTA
    purple: '#6b21ef',     // インタラクティブ要素
    green: '#35a670',      // 成功状態
  },

  // 白のオーバーレイ（透明度）
  overlay: {
    5: 'rgba(255, 255, 255, 0.05)',
    10: 'rgba(255, 255, 255, 0.1)',
    15: 'rgba(255, 255, 255, 0.15)',
    20: 'rgba(255, 255, 255, 0.2)',
  },
}
```

**思考パターン**:
```
ダークテーマUI実装 → n8n型パレット使用
高可読性が必要 → text.primary（#c4bbd3）
CTAボタン → accent.orange（#ee4f27）
グラスモーフィズム → overlay.10
```

### 2.1.2 ライトテーマパレット（Beam AI型）

```typescript
const lightColors = {
  primary: {
    light: '#1a66ff',
    dark: '#004ecc',
  },
  background: {
    white: '#ffffff',
    gray: '#e6e6e6',
  },
  text: {
    dark: '#18181b',
    gray: '#52525b',
  },
  accent: {
    blue: {
      light: '#99c0ff',
      medium: '#05f',
      dark: '#69f',
    },
  },
}
```

**思考パターン**:
```
ライトテーマUI実装 → Beam AI型パレット使用
プライマリアクション → primary.light（#1a66ff）
背景グラデーション → background.white to background.gray
```

### 2.1.3 グラデーションパレット（Relevance AI型）

```typescript
const gradients = {
  indigo: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  purple: 'linear-gradient(to bottom, #1f192a, transparent)',
  radial: 'radial-gradient(circle closest-corner at 50% 110%, #0f0a19, #26214900)',
}
```

**思考パターン**:
```
強調テキストにグラデーション → gradients.indigo
背景のグラデーション → gradients.purple or gradients.radial
```

---

## 2.2 タイポグラフィシステム

### 2.2.1 フォントスタック

```typescript
// tailwind.config.js
const fontFamily = {
  sans: ['Inter', 'Noto Sans', 'system-ui', 'sans-serif'],
  display: ['Satoshi', 'Epilogue', 'sans-serif'],
  mono: ['Inconsolata', 'Fragment Mono', 'DM Mono', 'monospace'],
  geometric: ['Geomanist', 'Outfit', 'sans-serif'],
}
```

**思考パターン**:
```
本文テキスト → font-sans（Inter）
見出し・強調 → font-display（Satoshi）
コードブロック → font-mono（Inconsolata）
モダンな見出し → font-geometric（Geomanist）
```

### 2.2.2 タイポグラフィスケール

| レベル | サイズ | 行高 | 用途 | クラス例 |
|--------|--------|------|------|----------|
| H1 | 56px | 100% | メインヒーロー | `text-[56px] leading-[100%]` |
| H2 | 54px | 100% | セクション見出し | `text-[54px] leading-[100%]` |
| H3 | 48px | 100% | サブセクション | `text-5xl` |
| H4 | 38px | 110% | カード見出し | `text-4xl` |
| H5 | 32px | 120% | 小見出し | `text-3xl` |
| Body-lg | 18px | 150% | リード文 | `text-lg` |
| Body | 16px | 160% | 本文 | `text-base` |
| Body-sm | 14px | 150% | キャプション | `text-sm` |

**思考パターン**:
```
ヒーロー見出し → H1（56px, 100%行高）
セクション見出し → H2（54px）
カード内見出し → H4（38px）
リード文 → Body-lg（18px, 150%行高）
本文 → Body（16px, 160%行高）
```

### 2.2.3 実装例

```tsx
// Hero見出し（n8n型）
<h1 className="text-[56px] leading-[100%] font-geometric font-bold text-white">
  Build teams of AI agents
</h1>

// インディゴ強調（Relevance AI型）
<h2 className="text-5xl font-display">
  Deliver <em className="text-indigo-500 not-italic">human-quality</em> work
</h2>
```

---

## 2.3 レイアウトグリッドシステム

### 2.3.1 12カラムレスポンシブグリッド（n8n型）

```tsx
// コンテナ
<div className="max-w-[1312px] mx-auto px-4">
  {/* 12カラムグリッド */}
  <div className="grid grid-cols-12 gap-4 md:gap-8 lg:gap-16">
    {/* 左カラム（4/12） */}
    <div className="col-span-12 lg:col-span-4">
      <h3>Feature 1</h3>
    </div>

    {/* 右カラム（8/12） */}
    <div className="col-span-12 lg:col-span-8">
      <p>Description...</p>
    </div>
  </div>
</div>
```

**思考パターン**:
```
12カラムグリッド → max-w-[1312px] コンテナ
モバイル → col-span-12（全幅）
デスクトップ → col-span-4 / col-span-8（4:8比率）
```

### 2.3.2 レスポンシブブレイクポイント（Beam AI型）

```typescript
// tailwind.config.js
const screens = {
  'sm': '640px',
  'md': '810px',   // Beam AI標準
  'lg': '1200px',  // Beam AI標準
  'xl': '1440px',
}
```

**思考パターン**:
```
モバイル → ~640px（sm未満）
タブレット → 640-810px（sm~md）
小型デスクトップ → 810-1200px（md~lg）
大型デスクトップ → 1200px以上（lg~）
```

### 2.3.3 スペーシングスケール

```typescript
const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  6: '24px',
  8: '32px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
}
```

**思考パターン**:
```
小さな余白 → p-2（8px）
標準余白 → p-4（16px）
セクション間 → py-12（48px）
大きなセクション → py-20（80px）
```

---

## 2.4 コンポーネントパターン

### 2.4.1 Hero Section（Relevance AI型）

```tsx
export const HeroSection = () => {
  return (
    <section className="relative min-h-screen bg-gradient-to-b from-navy-midnight to-navy-deep">
      {/* 背景装飾 */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/30 rounded-full blur-[100px]" />
      </div>

      {/* コンテンツ */}
      <div className="relative z-10 max-w-[1312px] mx-auto px-4 pt-32 pb-20">
        <div className="max-w-4xl mx-auto text-center">
          {/* ヘッドライン */}
          <h1 className="text-[56px] leading-[100%] font-bold text-white mb-6">
            Build teams of{' '}
            <span className="text-indigo-400">AI agents</span>
            {' '}that deliver human-quality work
          </h1>

          {/* サブヘッドライン */}
          <p className="text-xl text-text-secondary mb-8 max-w-2xl mx-auto">
            Automate complex workflows with intelligent agents that understand context and deliver results.
          </p>

          {/* デュアルCTA */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button className="bg-accent-orange hover:bg-accent-orange/90 text-white px-8 py-4 rounded-lg font-semibold text-lg transition-colors">
              Try for free →
            </button>
            <button className="bg-white/10 hover:bg-white/15 backdrop-blur-md text-white px-8 py-4 rounded-lg font-semibold text-lg border border-white/20 transition-colors">
              Request a demo
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
```

**思考パターン**:
```
インパクトのあるLP → Hero Section パターン
背景装飾 → blur-[100px] + opacity-20
デュアルCTA → プライマリ（bg-accent-orange）+ セカンダリ（bg-white/10）
```

### 2.4.2 プロダクトカードグリッド（Relevance AI型）

```tsx
interface ProductCard {
  title: string;
  description: string;
  features: string[];
  icon: React.ReactNode;
  badge?: string;
}

export const ProductCardGrid = ({ products }: { products: ProductCard[] }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {products.map((product, index) => (
        <div
          key={index}
          className="group relative bg-gradient-to-b from-white/10 to-transparent backdrop-blur-[30px] border border-white/10 rounded-xl p-6 hover:bg-white/15 transition-all duration-300"
        >
          {/* バッジ */}
          {product.badge && (
            <span className="absolute top-4 right-4 bg-accent-purple text-white text-xs px-3 py-1 rounded-full">
              {product.badge}
            </span>
          )}

          {/* アイコン */}
          <div className="mb-4 text-accent-orange">
            {product.icon}
          </div>

          {/* タイトル */}
          <h3 className="text-2xl font-bold text-white mb-3">
            {product.title}
          </h3>

          {/* 説明 */}
          <p className="text-text-secondary mb-4">
            {product.description}
          </p>

          {/* 特徴リスト */}
          <ul className="space-y-2 mb-6">
            {product.features.map((feature, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                <svg className="w-5 h-5 text-accent-green flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>

          {/* CTA */}
          <button className="w-full bg-white/5 hover:bg-white/10 text-white py-3 rounded-lg border border-white/10 transition-colors group-hover:border-accent-orange/50">
            Learn more →
          </button>
        </div>
      ))}
    </div>
  );
};
```

**思考パターン**:
```
プロダクト紹介 → ProductCardGrid パターン
グラスモーフィズム → backdrop-blur-[30px]
ホバーエフェクト → hover:bg-white/15
バッジ表示 → 右上にbadge
```

### 2.4.3 カスタマーロゴマーキー（Relevance AI型）

```tsx
export const CustomerLogoMarquee = ({ logos }: { logos: string[] }) => {
  return (
    <div className="overflow-hidden">
      <div className="flex animate-marquee space-x-16">
        {/* ロゴを2回繰り返してシームレスなループを作成 */}
        {[...logos, ...logos].map((logo, index) => (
          <img
            key={index}
            src={logo}
            alt="Customer logo"
            className="h-8 w-auto grayscale opacity-70 hover:opacity-100 hover:grayscale-0 transition-all"
          />
        ))}
      </div>
    </div>
  );
};

// tailwind.config.js に追加
const animation = {
  marquee: 'marquee 30s linear infinite',
}
const keyframes = {
  marquee: {
    '0%': { transform: 'translateX(0%)' },
    '100%': { transform: 'translateX(-50%)' },
  },
}
```

**思考パターン**:
```
カスタマーロゴ表示 → CustomerLogoMarquee パターン
シームレスループ → ロゴを2回繰り返し
ホバー時カラー表示 → grayscale → hover:grayscale-0
```

### 2.4.4 テスティモニアルカード（Relevance AI型）

```tsx
interface Testimonial {
  quote: string;
  author: {
    name: string;
    title: string;
    company: string;
    avatar: string;
  };
  rating: number;
}

export const TestimonialCard = ({ testimonial }: { testimonial: Testimonial }) => {
  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6">
      {/* 星評価 */}
      <div className="flex gap-1 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <svg
            key={i}
            className={`w-5 h-5 ${i < testimonial.rating ? 'text-amber-400' : 'text-gray-600'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>

      {/* 引用 */}
      <blockquote className="text-text-primary text-lg mb-6 leading-relaxed">
        "{testimonial.quote}"
      </blockquote>

      {/* 著者情報 */}
      <div className="flex items-center gap-3">
        <img
          src={testimonial.author.avatar}
          alt={testimonial.author.name}
          className="w-12 h-12 rounded-full object-cover"
        />
        <div>
          <div className="text-white font-semibold">{testimonial.author.name}</div>
          <div className="text-text-secondary text-sm">
            {testimonial.author.title} at {testimonial.author.company}
          </div>
        </div>
      </div>
    </div>
  );
};
```

**思考パターン**:
```
顧客の声表示 → TestimonialCard パターン
星評価 → Array.from({ length: 5 })
グラスモーフィズム → bg-white/5 backdrop-blur-md
```

### 2.4.5 グラスモーフィズムカード（n8n型）

```tsx
export const GlassmorphismCard = ({ children }: { children: React.ReactNode }) => {
  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{
        background: 'radial-gradient(circle closest-corner at 50% 110%, #0f0a19, #26214900)',
        boxShadow: 'inset -1px -1px rgba(255,255,255,0.2), inset 1px 1px rgba(255,255,255,0.3)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <div className="backdrop-blur-[30px] p-8">
        {children}
      </div>
    </div>
  );
};
```

**思考パターン**:
```
グラスモーフィズム実装 → GlassmorphismCard パターン
radialグラデーション背景 → background: 'radial-gradient(...)'
insetシャドウ → boxShadow: 'inset ...'
```

### 2.4.6 デュアルCTAボタンセット

```tsx
export const DualCTAButtons = () => {
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      {/* プライマリCTA */}
      <button className="group relative overflow-hidden bg-accent-orange hover:bg-accent-orange/90 text-white px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-300">
        <span className="relative z-10 flex items-center justify-center gap-2">
          Try for free
          <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </span>
      </button>

      {/* セカンダリCTA */}
      <button className="group bg-white/10 hover:bg-white/15 backdrop-blur-md text-white px-8 py-4 rounded-lg font-semibold text-lg border border-white/20 hover:border-white/30 transition-all duration-300">
        <span className="flex items-center justify-center gap-2">
          Request a demo
          <svg className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </span>
      </button>
    </div>
  );
};
```

**思考パターン**:
```
デュアルCTA実装 → DualCTAButtons パターン
プライマリ → bg-accent-orange（オレンジ）
セカンダリ → bg-white/10（透明）
アイコンアニメーション → group-hover:translate-x-1
```

---

## 2.5 アニメーション・インタラクションパターン

### 2.5.1 スクロールフェードイン（Relevance AI型）

```tsx
'use client';

import { useEffect, useRef } from 'react';

export const ScrollFadeIn = ({ children }: { children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-fade-in');
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="opacity-0 translate-y-8 transition-all duration-700">
      {children}
    </div>
  );
};

// tailwind.config.js に追加
const animation = {
  'fade-in': 'fadeIn 0.7s ease-out forwards',
}
const keyframes = {
  fadeIn: {
    '0%': { opacity: '0', transform: 'translateY(32px)' },
    '100%': { opacity: '1', transform: 'translateY(0)' },
  },
}
```

**思考パターン**:
```
スクロール時フェードイン → ScrollFadeIn パターン
IntersectionObserver使用 → threshold: 0.1（10%表示で発火）
アニメーション → opacity-0 translate-y-8 → animate-fade-in
```

### 2.5.2 ホバーエフェクト（n8n型）

```tsx
export const HoverCard = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="group relative transition-all duration-300 hover:scale-[1.02]">
      <div className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl p-6 transition-all duration-300">
        {children}
      </div>

      {/* ホバー時のグロー効果 */}
      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-orange/0 via-accent-orange/10 to-accent-orange/0 blur-xl" />
      </div>
    </div>
  );
};
```

**思考パターン**:
```
ホバーエフェクト → HoverCard パターン
スケール変化 → hover:scale-[1.02]
グロー効果 → blur-xl + opacity-0 → group-hover:opacity-100
```

---

## 2.6 レスポンシブパターン

### 2.6.1 モバイルファーストグリッド

```tsx
// 1カラム（モバイル）→ 2カラム（タブレット）→ 3カラム（デスクトップ）
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 lg:gap-8">
  {items.map(item => (
    <div key={item.id} className="...">
      {/* カードコンテンツ */}
    </div>
  ))}
</div>

// 縦積み（モバイル）→ 横並び（タブレット以上）
<div className="flex flex-col md:flex-row gap-4 md:gap-8">
  <div className="w-full md:w-1/3">Left</div>
  <div className="w-full md:w-2/3">Right</div>
</div>
```

**思考パターン**:
```
レスポンシブグリッド → grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3
縦積み→横並び → flex flex-col md:flex-row
```

### 2.6.2 アスペクト比制御（n8n型）

```tsx
// ビデオ比率（16:9）
<div className="aspect-video bg-navy-deep rounded-xl overflow-hidden">
  <video src="..." className="w-full h-full object-cover" />
</div>

// 正方形
<div className="aspect-square bg-navy-deep rounded-xl overflow-hidden">
  <img src="..." className="w-full h-full object-cover" />
</div>

// カスタム比率（1.88:1）
<div className="aspect-[1.88] bg-navy-deep rounded-xl overflow-hidden">
  <img src="..." className="w-full h-full object-cover" />
</div>
```

**思考パターン**:
```
16:9比率 → aspect-video
正方形 → aspect-square
カスタム比率 → aspect-[1.88]
```

---

## 2.7 パフォーマンス最適化

### 2.7.1 Will-Change最適化（Beam AI型）

```css
/* アニメーションする要素 */
.animated-element {
  will-change: transform, opacity;
}

/* アニメーション終了後は解除 */
.animated-element.animation-complete {
  will-change: auto;
}
```

**思考パターン**:
```
アニメーション要素 → will-change: transform, opacity
アニメーション終了後 → will-change: auto（パフォーマンス向上）
```

### 2.7.2 Backdrop Blur最適化（n8n型）

```tsx
// iOS Safariでのパフォーマンス考慮
<div className="backdrop-blur-[30px] [backdrop-filter:blur(30px)] [-webkit-backdrop-filter:blur(30px)]">
  {/* グラスモーフィズムコンテンツ */}
</div>
```

**思考パターン**:
```
グラスモーフィズム → backdrop-blur-[30px]
iOS Safari対応 → -webkit-backdrop-filter:blur(30px)
```

---

## 2.8 実装チェックリスト

### デザインシステム
- [ ] カラーパレット（ダーク/ライト）を定義
- [ ] タイポグラフィスケールを設定
- [ ] スペーシングシステムを統一
- [ ] レスポンシブブレイクポイントを決定

### コンポーネント
- [ ] Heroセクション（デュアルCTA）
- [ ] プロダクトカードグリッド
- [ ] カスタマーロゴマーキー
- [ ] テスティモニアルカード
- [ ] グラスモーフィズムカード

### UX
- [ ] スクロールアニメーション実装
- [ ] ホバーエフェクト設定
- [ ] モバイルレスポンシブ確認
- [ ] アクセシビリティ（色コントラスト4.5:1以上）

### パフォーマンス
- [ ] Will-change最適化
- [ ] Backdrop blur最適化
- [ ] 画像遅延読み込み
- [ ] フォント最適化（subset、preload）

---

# Troubleshooting

## 問題1: shadcn/uiコンポーネントが動作しない

**症状**:
- コンポーネントがインポートできない
- スタイルが適用されない

**原因**:
- Tailwind CSS設定不足
- shadcn/ui CLI未実行

**対処**:
1. `npx shadcn-ui@latest init` 実行
2. `tailwind.config.js` に shadcn/ui設定追加
3. `components.json` 確認

**Example**:
```bash
npx shadcn-ui@latest init
npx shadcn-ui@latest add button
```

---

## 問題2: ダークテーマの色が期待通りでない

**症状**:
- テキストの可読性が低い
- 背景色が明るすぎる/暗すぎる

**原因**:
- カラーパレットが正しく設定されていない
- Tailwind CSS設定でカスタムカラーが反映されていない

**対処**:
1. `tailwind.config.js` の `theme.extend.colors` にn8n型パレット追加
2. コントラスト比4.5:1以上を確認（WebAIM Contrast Checkerで検証）

**Example**:
```typescript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        background: {
          'navy-midnight': '#0e0918',
          'navy-deep': '#1f192a',
        },
        text: {
          primary: '#c4bbd3',
          secondary: '#6f87a0',
        },
      },
    },
  },
}
```

---

## 問題3: アニメーションがカクつく

**症状**:
- スクロールアニメーションがスムーズでない
- ホバーエフェクトが遅延する

**原因**:
- will-change未設定
- backdrop-blur使用による負荷

**対処**:
1. アニメーション要素に `will-change: transform, opacity` 追加
2. backdrop-blurを `backdrop-blur-[30px]` に制限
3. iOS Safariで `-webkit-backdrop-filter` 追加

**Example**:
```tsx
<div className="transition-transform duration-300 will-change-transform hover:scale-105">
  {/* コンテンツ */}
</div>
```

---

## 問題4: グラスモーフィズムカードが表示されない

**症状**:
- backdrop-blurが効いていない
- 背景が透けて見えない

**原因**:
- 親要素に背景画像/色がない
- backdrop-filter未対応ブラウザ

**対処**:
1. 親要素に背景画像 or グラデーション追加
2. fallback用に `bg-white/10` 等の半透明背景追加

**Example**:
```tsx
<div className="bg-gradient-to-b from-navy-midnight to-navy-deep">
  <GlassmorphismCard>
    {/* コンテンツ */}
  </GlassmorphismCard>
</div>
```

---

## 問題5: レスポンシブグリッドが崩れる

**症状**:
- モバイルで横にはみ出る
- デスクトップでレイアウトが崩れる

**原因**:
- ブレイクポイント設定ミス
- gap設定が大きすぎる

**対処**:
1. `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` の順序確認
2. gap を `gap-4 md:gap-6 lg:gap-8` で段階的に調整

**Example**:
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 lg:gap-8">
  {/* カード */}
</div>
```

---

# Version History

| バージョン | 日付 | 変更内容 |
|----------|------|---------|
| v2.0 | 2025-12-30 | 2 Skills統合版作成（shadcn-ui-resources + modern-saas-design-patterns） |
| v1.0 | 2025-12-25 | 各Skill個別に作成 |

---

**最終更新**: 2025-12-30
**作成者**: Claude Code (Phase 3.5)
**統合Skills**: shadcn-ui-resources (192行) + modern-saas-design-patterns (702行) = 約1,100行 ✅ OPTIMAL
