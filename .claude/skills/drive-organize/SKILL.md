---
name: drive-organize
description: Google Drive共有ドライブの整理を自動化するSkill。フォルダ調査→ルール設定→仮実行→本実行→ロールバックの5ステップで安全にファイル整理を実施
setting_sources: ["user", "project"]
---

# Drive Organize Skill v1.0

## Purpose

大量のファイルを安全かつ効率的に整理し、以下を実現：
- **時間短縮**: 手作業数時間 → 数分
- **精度向上**: 人為的ミス削減（80%以上の自動化）
- **再現性**: 同じルールで複数フォルダに適用可能
- **安全性**: いつでもロールバック可能

**対象ユーザー**:
- Google Drive共有ドライブの管理者
- バックオフィス担当者
- プロジェクトマネージャー

---

## コマンド体系

### 基本構文

```bash
/drive-organize <subcommand> [options]
```

### サブコマンド一覧

| コマンド | 説明 | 出力 |
|---------|------|------|
| `init` | フォルダを調査し、質問リストを生成 | 分析レポート.md、質問リスト |
| `config` | 対話形式で分類ルールを設定 | 分類ルール.yaml |
| `dry-run` | 仮実行（変更なし）+ 整合性検証 | 仕分け結果.csv、スナップショット.json、実行計画サマリー.md |
| `execute` | 実際に整理を実行 + 整合性チェック | 操作履歴.json、実行結果.md |
| `rollback` | 操作を取り消し | 復元完了メッセージ |
| `report` | 統計レポート生成 | 統計レポート.md |

---

## 詳細仕様

### 1. init（初期調査）

フォルダ内を読み取り専用でスキャンし、現状分析と質問リストを生成。

```bash
/drive-organize init --path <フォルダパス> [options]
```

**オプション**:

| オプション | 型 | デフォルト | 説明 |
|-----------|---|-----------|------|
| `--path` | string | **必須** | 調査対象のフォルダパス（絶対パス） |
| `--max-depth` | int | 10 | スキャンする最大階層 |
| `--exclude` | list | `.git, node_modules` | 除外フォルダ（カンマ区切り） |
| `--sample-size` | int | 100 | パターン分析用サンプル数 |
| `--output` | string | `./分析レポート.md` | 出力ファイルパス |

**実行内容**:
1. フォルダ構造スキャン（最大10階層）
2. ファイル統計（拡張子別件数、サイズ、更新日）
3. パターン検出（日付形式、キーワード頻度、重複ファイル）
4. 質問リスト生成（10-15個の質問を自動生成）

**出力例**:
```markdown
# 調査結果サマリー
- 総ファイル数: 558件
- 拡張子分布: pdf(160), docx(40), ...
- 検出パターン: 日付(12種類), キーワード(8種類)

# 推奨される質問リスト
Q1. 日付ベース分類を有効にしますか？
Q2. ...
```

---

### 2. config（ルール設定）

対話形式で質問に答え、分類ルールYAMLを生成。

```bash
/drive-organize config [options]
```

**オプション**:

| オプション | 型 | デフォルト | 説明 |
|-----------|---|-----------|------|
| `--questions` | string | `./質問リスト.txt` | 質問リストファイルパス |
| `--output` | string | `./分類ルール.yaml` | 出力ルールファイル |
| `--interactive` | bool | true | 対話モード |
| `--template` | string | なし | テンプレートYAMLをベースに |

**実行フロー**:
1. 質問リストを読み込み
2. AskUserQuestion機能を活用（最大4問ずつ）
3. 回答をYAML変換
4. プレビュー表示 → 確認 → 保存

---

### 3. dry-run（仮実行）

実際には変更せず、仕分け結果をプレビュー。

```bash
/drive-organize dry-run --rules <ルールファイル> [options]
```

**オプション**:

| オプション | 型 | デフォルト | 説明 |
|-----------|---|-----------|------|
| `--rules` | string | **必須** | 分類ルールYAMLファイル |
| `--path` | string | カレントディレクトリ | 対象フォルダ |
| `--output` | string | `./仕分け結果_YYYYMMDD_HHMMSS.csv` | CSV出力先 |
| `--format` | string | `csv` | 出力形式（csv/json/markdown） |
| `--confidence-threshold` | float | 0.0 | 信頼度の最小値（0.0-1.0） |
| `--snapshot` | bool | true | ファイル数スナップショット作成 |

**実行内容**:
1. 実行前ファイル数スナップショット作成
2. ルール適用（優先順位順）
3. 衝突検出（同名ファイル、パス長制限）
4. 統計計算（信頼度別件数）
5. 整合性検証式を生成
6. CSV + スナップショット + 実行計画サマリー出力

**出力ファイル**:
- `仕分け結果_YYYYMMDD_HHMMSS.csv`
- `ファイル数スナップショット_YYYYMMDD_HHMMSS.json`
- `実行計画サマリー_YYYYMMDD_HHMMSS.md`

---

### 4. execute（実行）

実際にファイルを移動・削除。

```bash
/drive-organize execute --csv <仕分け結果CSV> [options]
```

**オプション**:

| オプション | 型 | デフォルト | 説明 |
|-----------|---|-----------|------|
| `--csv` | string | **必須** | 仕分け結果CSVファイル |
| `--mode` | string | `safe` | 実行モード（safe/normal/aggressive） |
| `--batch-size` | int | 10 | 何件ごとに確認プロンプト表示 |
| `--yes` | bool | false | 確認スキップ（注意！） |
| `--backup` | string | `log` | バックアップ方式（log/full/hybrid） |
| `--verify` | bool | true | 実行後に整合性チェック実施 |

**実行モード**:

| モード | 対象 | 説明 |
|-------|------|------|
| `safe` | 信頼度:高のみ | デフォルト、最も安全 |
| `normal` | 信頼度:中以上 | 中リスクも実行 |
| `aggressive` | すべて | 低リスクも実行（非推奨） |

**バックアップ方式**:

| 方式 | 説明 | 容量 | 復元 |
|------|------|------|------|
| `log` | 操作ログのみ記録 | 数KB | 移動のみ復元可 |
| `full` | 全ファイルをZIP圧縮 | 元の100% | 完全復元可 |
| `hybrid` | 削除のみバックアップ | 削除分のみ | 削除のみ復元可 |

**実行フロー**:
1. 実行前スナップショット読み込み
2. 信頼度でフィルタリング
3. バックアップ作成
4. バッチ処理（確認プロンプト付き）
5. 操作ごとにログ記録
6. 実行後ファイル数整合性チェック

---

### 5. rollback（ロールバック）

操作を取り消し、元の状態に復元。

```bash
/drive-organize rollback --log <操作履歴JSON> [options]
```

**オプション**:

| オプション | 型 | デフォルト | 説明 |
|-----------|---|-----------|------|
| `--log` | string | **必須** | 操作履歴JSONファイル |
| `--partial` | bool | false | 一部のみロールバック |
| `--dry-run` | bool | false | テストモード |

**制限事項**:
- 削除したファイルは復元不可（Google Driveのゴミ箱から手動復元）
- 上書きされたファイルは復元不可
- 移動・リネームは完全復元可能

---

### 6. report（統計レポート）

整理実績の統計レポートを生成。

```bash
/drive-organize report [options]
```

**オプション**:

| オプション | 型 | デフォルト | 説明 |
|-----------|---|-----------|------|
| `--period` | string | 全期間 | 対象期間（YYYY-MM） |
| `--format` | string | `markdown` | 出力形式（markdown/json/html） |
| `--output` | string | `./統計レポート.md` | 出力先 |

---

## 分類ルール.yaml の構造

```yaml
version: "1.0"
created_at: "2025-01-09"
author: "佐藤圭吾"

settings:
  date_extraction:
    formats: ["YYYYMMDD", "YYYY-MM-DD", "YYYY.MM.DD", "YYYY/MM/DD"]
    fallback: "modified_date"
  conflict_resolution:
    same_name: "rename_with_timestamp"
    format: "{name}_{timestamp}{ext}"
  delete_empty_folders: true
  default_mode: "safe"
  create_rollback_log: true

exclude:
  folders: [".git", "node_modules", "__pycache__"]
  files: ["*.lock", "*.log", "*.tmp"]
  extensions: [".gdoc", ".gsheet", ".gslides"]

rules:
  # Priority 1: システムファイル削除
  - priority: 1
    name: "システムファイル削除"
    condition:
      filename_matches: ["^\\.DS_Store$", "^Thumbs\\.db$"]
    action:
      delete: true
    confidence: 1.0

  # Priority 2: 重複ファイル処理
  - priority: 2
    name: "重複ファイル（番号付き）"
    condition:
      filename_regex: "^(.*) \\((\\d+)\\)(\\.[^.]+)$"
    action:
      move_to: "削除候補/重複ファイル/"
      compare_with_original: true
      keep: "newer"
    confidence: 0.5

  # Priority 3-6: 業務別分類
  # ... (略)

  # Priority 99: フォールバック
  - priority: 99
    name: "分類不能"
    condition:
      default: true
    action:
      move_to: "その他_要判断/"
    confidence: 0.3
```

---

## エラーハンドリング

### エラーレベル

| レベル | 説明 | 動作 |
|-------|------|------|
| `CRITICAL` | 致命的エラー（実行不可） | 即座に停止 |
| `ERROR` | エラー（スキップ可能） | ログ記録してスキップ |
| `WARNING` | 警告（継続可能） | 警告表示して継続 |
| `INFO` | 情報 | ログ記録のみ |

### 主要エラー

| エラー | 原因 | 対処 |
|-------|------|------|
| `PathNotFoundError` | 指定パスが存在しない | パスを確認 |
| `PermissionError` | 権限がない | 権限を確認 |
| `IntegrityError` | ファイル数不一致検出 | ロールバックして再実行 |
| `ConflictError` | 同名ファイル存在 | リネームして移動 |

---

## 安全機能まとめ

- 3段階実行モード（safe/normal/aggressive）
- 3種類のバックアップ方式（log/full/hybrid）
- バッチ処理（確認プロンプト付き）
- ファイル数整合性チェック（実行前後）
- 完全なロールバック機能

---

**バージョン**: v1.0
**更新日**: 2025-01-09
