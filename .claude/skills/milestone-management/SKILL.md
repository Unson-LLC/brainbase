---
name: milestone-management
description: brainbaseにおけるマイルストーン管理のルール。正本はNocoDB（各プロジェクトBase）の「マイルストーン」テーブル。_codex/projects/のmdファイルは参照用サマリーとして補助的に使用。新規マイルストーン作成・更新時に使用。
---

## Triggers

以下の状況で使用：
- 新規マイルストーンを作成するとき
- プロジェクトの進捗状況を更新するとき
- マイルストーン管理の正本がどこか確認したいとき

# マイルストーン管理ルール

## 1. マイルストーンとは何か

**「四半期〜月単位の大きなゴール」を管理する。**

プロジェクトの方向性を決める節目。「いつまでに何を達成するか」を宣言し、進捗を追う。

### Value Loopでの位置づけ

```
    ┌─── Decision（決める）───┐  ← ★マイルストーンはここ
    │                          │
  Learn                    Work
 （学ぶ）                （やる）
    │                          │
    └──── Ship（届ける）───────┘
```

マイルストーンは**Decision**を担う。何を達成するか決め、その達成条件を定義する。

---

## 2. 正本の場所

**正本**: NocoDB 各プロジェクトBaseの「マイルストーン」テーブル
**補助**: `_codex/projects/<project>/decisions/` にWHY（判断根拠）を記録

### SSOT分担

| 層 | 置き場 | 管理するもの |
|----|--------|-------------|
| **Meaning（WHY）** | `_codex/projects/{project}/decisions/` | なぜこのマイルストーンを置くか |
| **State（現状）** | NocoDB マイルストーンテーブル | 進捗率、ステータス、期限 |

---

## 3. NocoDBベース一覧（2026-01-27時点）

| ベース | Base ID | GM（責任者） |
|--------|---------|-------------|
| **BAAO** | `pqj22ze3jh0mkms` | 山本力弥 |
| **DialogAI** | `ptykrgx40t36l9y` | 佐藤圭吾 |
| **NCOM** | `p95wu69gwchz94m` | 山本力弥 |
| **SalesTailor** | `pqot58neiu3o1xo` | 堀汐里 |
| **Senrigan** | `p0f59uaty8zr8yd` | 金田光平 |
| **Mywa** | `p8gn2zt3k3bhia3` | 山本力弥 |
| **Zeims** | `pr8u5q4qnb8op11` | 川合秀明 |
| **BackOffice** | `pypw36aox9nkhb6` | 佐藤圭吾 |
| **Brainbase** | `pva7l2qlu6fdfip` | 佐藤圭吾 |
| **Tech Knight** | `p3tzrrtqi5hm40t` | 倉本裕太 |
| **VibePro** | `pfgza5aei6wboaq` | 佐藤圭吾 |

---

## 4. テーブル構造

| カラム | 型 | 必須 | 説明 |
|--------|-----|------|------|
| **名前** | SingleLineText | Yes | M0, M1... または具体名 |
| **説明** | LongText | - | Objective + Key Results |
| **期限** | Date | Yes | 達成目標日 |
| **ステータス** | SingleSelect | Yes | 未着手/進行中/完了/遅延 |
| **進捗率** | Number | - | 0〜100% |
| **ブロッカー** | LongText | - | 障害となっている事項 |
| **担当者** | SingleLineText | Yes | 責任者 |
| **Decision参照** | SingleLineText | - | `_codex/`内の判断根拠パス |

### シップとのリレーション

```
マイルストーン ──1:N──→ シップ（関連マイルストーン）
```

シップテーブルの「関連マイルストーン」カラムでリンク。これにより「このマイルストーンに寄与した出荷物」が追跡できる。

---

## 5. マイルストーン命名規則

**フォーマット**: `M{番号}: {目標}（{期限}）`

```
M0: αリリース（2025/10末）
M1: SSW仮説検証完了（2025/12末）
M2: βリリース（2025/12末）
M3: 正式リリース（2026/1末）
```

**番号の意味**:
- M0: 初期リリース・基盤構築
- M1-M2: SPF（Solution/Product Fit）段階
- M3-M4: PMF（Product/Market Fit）検証段階
- M5以降: スケール・最適化段階

---

## 6. Key Resultの記述

各マイルストーンに**達成基準**を設定：

```markdown
| Key Result | 達成基準 | 担当 | 状態 |
|------------|----------|------|------|
| 有料ユーザー獲得 | 10社 | 川合 | 📋 |
| 継続率 | 50%以上 | CS | 📋 |
| NPS | 30以上 | CS | 📋 |
```

**状態**: ✅完了 / ⏳進行中 / 📋未着手 / 🚫ブロック

### Good Example

```
Objective: 決済機能込みで一般公開

Key Results:
- 支払い機能リリース（決済フロー稼働）
- ChatGPT-5.1切り替え（モデル更新）
- LP正式公開（ロゴ掲載4件）
```

### Bad Example

```
- ユーザーを増やす ❌ 定量的でない
- がんばる ❌ 達成基準なし
- いろいろやる ❌ 曖昧
```

---

## 7. GMの管理責任

GMがマイルストーンに対して持つ責任：

| 責任 | 内容 |
|------|------|
| **設定** | マイルストーンの作成・期限設定 |
| **更新** | 進捗率の更新（月1回以上） |
| **Decision記録** | `_codex/projects/{project}/decisions/` にWHYを記録 |
| **シップ確認** | マイルストーンに寄与するシップの品質確認 |
| **遅延対応** | 遅延時はステータスを変更しブロッカーを記載 |

---

## 8. 運用フロー

### 新規マイルストーン作成

```
1. NocoDBにマイルストーンレコード作成
2. Key Resultを「説明」フィールドに記述
3. 担当者・期限を設定
4. Decision参照を設定（`_codex/projects/{project}/decisions/YYYY-MM-DD_xxx.md`）
5. _codex/にWHY（判断根拠）を記録
```

**MCP操作例**:

```
mcp__nocodb__nocodb_create_record
  baseId: "pva7l2qlu6fdfip"
  tableName: "マイルストーン"
  fields: {
    "名前": "M2: βリリース（決済付き一般公開）",
    "説明": "Objective: 決済機能込みで一般公開\n\nKey Results:\n- 支払い機能リリース\n- LP正式公開",
    "期限": "2026-01-31",
    "ステータス": "進行中",
    "進捗率": 40,
    "担当者": "佐藤"
  }
```

### 進捗更新

```
1. NocoDBのステータス・進捗率を更新
2. ブロッカーがあれば記録
3. 遅延の場合はステータスを「遅延」に変更
```

**MCP操作例**:

```
mcp__nocodb__nocodb_update_record
  baseId: "pva7l2qlu6fdfip"
  tableName: "マイルストーン"
  recordId: "123"
  fields: {
    "進捗率": 60,
    "ブロッカー": "決済連携のAPI仕様が未確定"
  }
```

### マイルストーン完了

```
1. NocoDBでステータスを「完了」に変更
2. 完了日を記録（必要に応じてカスタムフィールド）
3. 学びを記録（レトロスペクティブ）
4. _codex/projects/のサマリーに実績を反映
```

---

## 9. _codex/projects/ のサマリーファイル

**用途**: 戦略的コンテキストの参照（正本ではない）

**ファイル名**: `milestone_spf_pmf.md` または `milestone_operational.md`

**含めるべき**:
- フィットジャーニー上の位置
- PMF達成の定義（定性・定量）
- タイムライン概観
- 優先度マトリクス
- 競合環境と差別化
- 体制・リスク・次のアクション

**含めない**（NocoDBが正本）:
- 個別タスクの詳細
- スプリント単位の進捗
- 日次の作業ログ

---

## 10. saas-ai-roadmap-playbookとの連携

マイルストーン設計時は`skill: saas-ai-roadmap-playbook`を参照：

- **CPF → PSF → SPF → PMF** のフェーズ設計
- **OKR/KPI** によるKey Result設定
- **Must Have / Nice to Have / Not Now** の優先度分類
- **Build-Measure-Learn** サイクルの組み込み

---

## 11. よくある失敗パターン

**❌ mdファイルを正本として運用**
→ ✅ NocoDBを正本、mdはサマリー

**❌ Key Resultが曖昧**（例: ユーザーを増やす）
→ ✅ 定量的に（例: 有料ユーザー10社獲得）

**❌ マイルストーンとタスクの混同**（例: M1: バグ修正）
→ ✅ マイルストーンは「達成状態」、タスクは「作業」

**❌ 遅延を隠す**
→ ✅ 遅延になったらステータスを即変更し、ブロッカーを記載

**❌ Decision参照を残さない**
→ ✅ WHY（なぜこのマイルストーンを置くか）を`_codex/`に記録

---

## 12. 関連Skills

| Skill | 用途 |
|-------|------|
| **nocodb-4table-guide** | 4テーブル運用の全体像・MCP操作 |
| **ship-management** | シップの詳細運用 |
| **sprint-management** | スプリントの週次運用 |
| **saas-ai-roadmap-playbook** | PMFフェーズ設計・OKR/KPI設定 |

---

最終更新: 2026-01-27（Value Loop連携・シップリレーション・ベースID最新化）
