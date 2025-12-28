# brainbase-ui リファクタリングドキュメント

このディレクトリには、brainbase-uiの大規模リファクタリングに関するドキュメントが格納されています。

---

## 📚 ドキュメント一覧

### 計画書

| ドキュメント | 内容 | 読むべき人 |
|------------|------|----------|
| [REFACTORING_PLAN.md](./REFACTORING_PLAN.md) | 全体計画とタイムライン | 全員 |
| [architecture/PROPOSED_ARCHITECTURE.md](./architecture/PROPOSED_ARCHITECTURE.md) | 新アーキテクチャ設計 | 開発者 |

### 実装ガイド

| Phase | ドキュメント | 期間 | 内容 |
|-------|-----------|------|------|
| Phase 1 | [architecture/PHASE1_IMPLEMENTATION_GUIDE.md](./architecture/PHASE1_IMPLEMENTATION_GUIDE.md) | 2-3日 | Event Bus, Store, DI Container実装 |
| Phase 2 | 🚧 作成予定 | 3-4日 | クライアント側分割 |
| Phase 3 | 🚧 作成予定 | 2-3日 | サーバー側分割 |

---

## 🎯 リファクタリングの目的

### 現状の問題

- **app.js**: 2,203行（全体の32%）
- **server.js**: 1,384行
- **密結合**: グローバル変数への強い依存
- **循環参照**: レンダリングと状態管理の混在
- **保守困難**: 以前900行まで削減したが、それ以上は不可能だった

### 目標

| 指標 | 現状 | 目標 |
|------|------|------|
| app.js行数 | 2,203行 | **100行以下** |
| server.js行数 | 1,384行 | **200行以下** |
| 最大ファイルサイズ | 2,203行 | **300行以下** |
| Cyclomatic Complexity (app.js) | ~120 | **~20** |

---

## 🚀 クイックスタート

### 1. 計画を理解する

```bash
# メイン計画書を読む
cat docs/REFACTORING_PLAN.md

# アーキテクチャ設計を読む
cat docs/architecture/PROPOSED_ARCHITECTURE.md
```

### 2. Phase 1を開始

```bash
# Phase 1実装ガイドを読む
cat docs/architecture/PHASE1_IMPLEMENTATION_GUIDE.md

# ブランチ作成
git checkout -b refactor/phase1-infrastructure

# テスト環境確認
npm run test
```

### 3. 実装

Phase 1の実装順序:
1. Event Bus実装とテスト
2. Reactive Store実装とテスト
3. DI Container実装とテスト
4. HTTP Client実装とテスト
5. 統合確認

---

## 📖 アーキテクチャ概要

### 新しい構造

```
┌─────────────────────────────────┐
│   app.js (100行)                 │
│   ・DIコンテナ設定                │
│   ・ビューのマウント              │
└─────────────────────────────────┘
              ↓
┌─────────────────────────────────┐
│   Event Bus (イベント駆動)        │
└─────────────────────────────────┘
       ↓        ↓        ↓
┌─────────┐ ┌─────────┐ ┌─────────┐
│TaskView │ │Session  │ │Timeline │
│ (150行) │ │View     │ │View     │
│         │ │ (150行) │ │ (100行) │
└─────────┘ └─────────┘ └─────────┘
       ↓        ↓        ↓
┌─────────────────────────────────┐
│   Service Layer                  │
│   TaskService | SessionService   │
└─────────────────────────────────┘
       ↓        ↓        ↓
┌─────────────────────────────────┐
│   Repository Layer               │
│   TaskRepo | SessionRepo         │
└─────────────────────────────────┘
```

### 主要コンポーネント

1. **Event Bus**: コンポーネント間の疎結合な通信
2. **Reactive Store**: アプリケーション状態の一元管理
3. **DI Container**: 依存関係の明示的な管理
4. **HTTP Client**: API通信の統一インターフェース

---

## 📅 タイムライン

```
Week 1 (Phase 1: インフラ整備)
├─ Day 1-2: Event Bus, Store, DI Container実装
└─ Day 3: 統合テスト

Week 2 (Phase 2: クライアント分割)
├─ Day 1-2: TaskService, TaskView
├─ Day 3-4: SessionService, SessionView
└─ Day 5: 旧コード削除

Week 3 (Phase 3: サーバー分割)
├─ Day 1: Routes, Controllers
├─ Day 2: Services, Repositories
└─ Day 3: 統合と旧コード削除
```

**総期間**: 約3週間（15営業日）

---

## ✅ 進捗管理

### Phase 1: インフラ整備

- [ ] Event Bus実装
- [ ] Reactive Store実装
- [ ] DI Container実装
- [ ] HTTP Client実装
- [ ] 統合テスト通過

### Phase 2: クライアント側分割

- [ ] TaskService + TaskView
- [ ] SessionService + SessionView
- [ ] TimelineView
- [ ] 旧app.jsからの移行完了

### Phase 3: サーバー側分割

- [ ] Routes分離
- [ ] Controllers実装
- [ ] Services実装
- [ ] Repositories実装
- [ ] 旧server.jsからの移行完了

---

## 🧪 テスト戦略

### テストピラミッド

```
      /\
     /E2E\      (5% - Playwright)
    /------\
   /  API   \   (15% - Supertest)
  /----------\
 / Unit Tests \ (80% - Vitest)
/--------------\
```

### テスト実行

```bash
# 全テスト
npm run test

# 特定ファイル
npm run test tests/core/event-bus.test.js

# カバレッジ
npm run test:coverage
```

---

## 🛡️ リスク管理

### 主要リスク

1. **既存機能の破壊**
   - 対策: 各フェーズでE2Eテスト実行
   - 対策: 段階的移行（新旧コード並行稼働）

2. **パフォーマンス劣化**
   - 対策: イベントリスナーの適切な管理
   - 対策: メモ化の活用

3. **スケジュール遅延**
   - 対策: 各フェーズを独立して完了可能に
   - 対策: 優先度の高い部分から着手

### ロールバック計画

各フェーズ完了時にタグを打つ:
```bash
git tag v0.2.0-phase1-complete
git tag v0.2.0-phase2-complete
git tag v0.2.0-phase3-complete
```

問題発生時は該当タグに戻す:
```bash
git checkout v0.2.0-phase1-complete
```

---

## 📞 質問・サポート

### よくある質問

**Q: Phase 1だけ実装して、Phase 2/3は後回しにできる？**
A: はい。各フェーズは独立しており、段階的に進めることができます。

**Q: 既存のモジュール（task-manager.js等）はどうなる？**
A: Phase 2で新しいService層に統合されます。移行後は削除されます。

**Q: テストカバレッジの目標は？**
A: 新規コードは80%以上を目指します。

### トラブルシューティング

問題が発生した場合:
1. [PHASE1_IMPLEMENTATION_GUIDE.md](./architecture/PHASE1_IMPLEMENTATION_GUIDE.md) のトラブルシューティングを確認
2. `npm run test` でテストが通るか確認
3. `git status` で意図しない変更がないか確認

---

## 📝 ドキュメント更新履歴

| 日付 | 変更内容 | 作成者 |
|------|---------|--------|
| 2025-12-22 | 初版作成 | Claude |

---

**次のステップ**: [REFACTORING_PLAN.md](./REFACTORING_PLAN.md) を読んで全体像を把握してください。
