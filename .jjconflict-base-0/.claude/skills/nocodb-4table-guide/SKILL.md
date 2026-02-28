---
name: nocodb-4table-guide
description: NocoDB 4テーブル運用（マイルストーン・スプリント・タスク・シップ）の統合ガイド。Value Loop概念、ベースID一覧、MCP操作方法、SSOT分担を参照する際に使用。
---

## Triggers

以下の状況で使用：
- NocoDB 4テーブルの全体像を把握したいとき
- Value Loop（Decision→Work→Ship→Learn）を理解したいとき
- NocoDBベースのIDを確認したいとき
- MCP Toolの使い方を確認したいとき

# NocoDB 4テーブル運用ガイド

## 1. brainbaseの根幹：循環モデル（Value Loop）

brainbaseの4テーブルは、この循環モデルを「回し続ける」ための装置。

```
    ┌─── Decision（決める）───┐
    │                          │
  Learn                    Work
 （学ぶ）                （やる）
    │                          │
    └──── Ship（届ける）───────┘
```

**Decision → Work → Ship → Learn → Decision → ...**

止まったら死ぬ。速く回るほど強くなる。

### 4テーブルとValue Loopの対応

| Value Loop | テーブル | 役割 | 記録するもの |
|------------|---------|------|-------------|
| **Decision** | マイルストーン | 何を達成するか決める | ゴール・期限・達成条件 |
| **Work** | スプリント + タスク | 計画し、実行する | 週次目標・個別作業 |
| **Ship** | シップ | 外に届けた成果を記録する | 出荷物・証跡・インパクト |
| **Learn** | スプリント（振り返り） | 学びを次のDecisionに返す | 完了事項・ブロッカー・学び |

---

## 2. SSOT分担：意味と状態の分離

brainbaseでは「情報の正本」を2層に分ける。

| 層 | 置き場 | 管理するもの | 例 |
|----|--------|-------------|-----|
| **Meaning（意味）** | `_codex/` | WHY・判断基準・ルール・用語定義 | 「なぜこのマイルストーンを置くか」の理由 |
| **State（状態）** | NocoDB | 現在の進捗・ステータス・数値 | 「進捗率60%」「ステータス:進行中」 |

**なぜ分けるか？**
- 意味（WHY）は変わりにくい → Gitで履歴管理
- 状態（HOW MUCH / WHERE）は毎日変わる → DB（NocoDB）でリアルタイム管理

---

## 3. テーブル間リレーション

```
マイルストーン ──1:N──→ シップ（関連マイルストーン）
シップ ──1:N──→ タスク（Ship紐付け）
スプリント ──1:N──→ タスク（Sprint週）
```

```
[マイルストーン] ← 方向を決める（Decision）
      ↓
[スプリント] ← 週次で計画（Work計画）
      ↓
[タスク] ← 個別に実行（Work実行）
      ↓
[シップ] ← 外に出す（Ship）←── タスクN:1シップ で紐付け
      ↓
[スプリント振り返り] ← 学ぶ（Learn）
      ↓
[マイルストーン更新] ← 次の判断へ（Decision）
      ↓
     ...永遠に回り続ける
```

---

## 4. NocoDBベース一覧

各プロジェクトベースのID一覧（2026-01-27時点）：

| ベース | Base ID | GM（責任者） | 備考 |
|--------|---------|-------------|------|
| **BAAO** | `pqj22ze3jh0mkms` | 山本力弥 | 代表理事、最終決裁 |
| **DialogAI** | `ptykrgx40t36l9y` | 佐藤圭吾 | プロダクト技術責任者 |
| **NCOM** | `p95wu69gwchz94m` | 山本力弥 | プロジェクト責任者 |
| **SalesTailor** | `pqot58neiu3o1xo` | 堀汐里 | CEO、事業最終決裁 |
| **Senrigan** | `p0f59uaty8zr8yd` | 金田光平 | GM、事業判断 |
| **Mywa** | `p8gn2zt3k3bhia3` | 山本力弥 | BAAO傘下、プロダクトオーナー |
| **Zeims** | `pr8u5q4qnb8op11` | 川合秀明 | GM、事業判断 |
| **BackOffice** | `pypw36aox9nkhb6` | 佐藤圭吾 | 内部運用・経理 |
| **Brainbase** | `pva7l2qlu6fdfip` | 佐藤圭吾 | 全体統括 |
| **Tech Knight** | `p3tzrrtqi5hm40t` | 倉本裕太 | CEO、最終決裁 |
| **VibePro** | `pfgza5aei6wboaq` | 佐藤圭吾 | Vibe Coding商用化 |

---

## 5. 4テーブルの構造サマリー

### マイルストーン

| カラム | 型 | 必須 | 説明 |
|--------|-----|------|------|
| 名前 | SingleLineText | Yes | M0, M1... または具体名 |
| 説明 | LongText | - | Objective + Key Results |
| 期限 | Date | Yes | 達成目標日 |
| ステータス | SingleSelect | Yes | 未着手/進行中/完了/遅延 |
| 進捗率 | Number | - | 0〜100% |
| 担当者 | SingleLineText | Yes | 責任者 |
| Decision参照 | SingleLineText | - | `_codex/`内の判断根拠パス |

### スプリント

| カラム | 型 | 記入者 | 説明 |
|--------|-----|--------|------|
| 期間 | SingleLineText | mana自動 | W04など |
| 開始日/終了日 | Date | mana自動 | 週の開始/終了 |
| 目標 | LongText | **GM手動** | 今週のフォーカス（2-3個） |
| 日次ログ | LongText | mana自動 | 日々のサマリー |
| 完了事項 | LongText | mana自動 | 今週完了したこと |
| ブロッカー | LongText | mana自動 | 今週の障害 |
| 学び | LongText | mana自動 | 振り返りで得た学び |

### タスク

| カラム | 型 | 必須 | 説明 |
|--------|-----|------|------|
| タイトル | SingleLineText | Yes | 動詞で始める |
| 担当者 | SingleLineText | Yes | 誰がやるか |
| ステータス | SingleSelect | Yes | 未着手/進行中/完了/保留 |
| 優先度 | SingleSelect | Yes | 高/中/低 |
| 期限 | Date | - | いつまでに |
| 説明 | LongText | - | 詳細・完了条件 |
| Ship紐付け | Link | - | 寄与するシップ |
| Sprint週 | Link | - | 該当スプリント |

### シップ

| カラム | 型 | 必須 | 説明 |
|--------|-----|------|------|
| タイトル | SingleLineText | Yes | 何を出荷したか |
| Ship種別 | SingleSelect | Yes | feature_released等 |
| ステータス | SingleSelect | Yes | planned/in_progress/in_review/shipped/verified |
| 担当者 | SingleLineText | - | 誰が出荷したか |
| 出荷日 | DateTime | shipped時Yes | shipped_at |
| 証跡URL | SingleLineText | shipped時Yes | PRリンク等 |
| 関連マイルストーン | Link | - | 寄与するマイルストーン |
| タスクs | Links | - | 紐付きタスク一覧（ロールアップ） |

---

## 6. MCP Tool 操作リファレンス

### ベース/テーブル一覧取得

```
# ベース一覧
mcp__nocodb__nocodb_list_bases

# テーブル一覧（baseId指定）
mcp__nocodb__nocodb_list_tables
  baseId: "pva7l2qlu6fdfip"

# テーブルメタ情報（カラム定義）
mcp__nocodb__nocodb_get_table_meta
  tableId: "m7iys8m7o1abr3f"
```

### レコード操作

```
# レコード一覧取得
mcp__nocodb__nocodb_list_records
  baseId: "pva7l2qlu6fdfip"
  tableName: "タスク"
  where: "(ステータス,eq,未着手)"  # オプション
  limit: 100
  offset: 0

# レコード作成
mcp__nocodb__nocodb_create_record
  baseId: "pva7l2qlu6fdfip"
  tableName: "タスク"
  fields: {
    "タイトル": "ログイン画面を実装する",
    "担当者": "keigo",
    "ステータス": "未着手",
    "優先度": "高"
  }

# レコード更新
mcp__nocodb__nocodb_update_record
  baseId: "pva7l2qlu6fdfip"
  tableName: "タスク"
  recordId: "123"
  fields: {
    "ステータス": "完了"
  }

# レコード削除
mcp__nocodb__nocodb_delete_record
  baseId: "pva7l2qlu6fdfip"
  tableName: "タスク"
  recordId: "123"
```

### よく使うフィルター条件（where句）

```
# 等価
(ステータス,eq,未着手)

# 不等価
(ステータス,neq,完了)

# AND条件
(ステータス,eq,未着手)~and(優先度,eq,高)

# 日付比較
(期限,lt,2026-01-31)
```

---

## 7. 関連Skills

| Skill | 用途 |
|-------|------|
| **ship-management** | シップの詳細運用（ステータスフロー、種別、North Star指標） |
| **sprint-management** | スプリントの週次運用（mana自動処理、Learn昇格） |
| **milestone-management** | マイルストーンの作成・更新（命名規則、Key Result） |
| **task-format** | ローカルタスクファイル（`_tasks/index.md`）の形式 |

---

## 8. よくある質問

**Q: 4つ全部使わないとダメ？**
A: 最低限「タスク」と「シップ」は使う。マイルストーンとスプリントはGMが管理。

**Q: _tasks/index.md とNocoDBタスクの違いは？**
A: `_tasks/index.md`は個人のローカルタスクリスト。NocoDBタスクはチーム共有の状態管理。両方使い分ける。

**Q: どのベースを使えばいい？**
A: プロジェクトごとに対応するベースを使用。Brainbase共通のものは`Brainbase`ベース（`pva7l2qlu6fdfip`）。

**Q: リンクカラム（Link）はどう設定する？**
A: 対象レコードのID（数値）を指定。例: `Ship紐付け: 123`

---

最終更新: 2026-01-27
