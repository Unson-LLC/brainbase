---
name: knowledge-frontmatter
description: Claude Skillsの登録フォーマットと作成手順。新規Skillを.claude/skills/に追加する際に使用。
---

## Triggers

以下の状況で使用：
- 新規Skillを作成するとき
- Skillのフォーマットを確認したいとき
- ベストプラクティスを参照したいとき

# Claude Skills 登録ガイド

brainbaseにおけるClaude Skills（`.claude/skills/*/SKILL.md`）の作成手順と標準フォーマット。

## ディレクトリ構造

**重要**: Skillsは以下の構造に従う必要があります：

```
.claude/skills/<skill-name>/SKILL.md
```

- ディレクトリ名: kebab-case（例: `nano-banana-pro-tips`）
- ファイル名: 必ず `SKILL.md`（大文字）
- **誤り**: `.claude/skills/<name>.md`（単なるMarkdownファイル）

## フォーマット

### 基本構造

```yaml
---
name: skill-name
description: Skillの説明文（Claude Codeの利用可能スキル一覧に表示される）
---

# スキル名

本文をMarkdownで記載...
```

### フロントマター（必須）

| 項目 | 説明 | 例 |
|------|------|-----|
| `name` | スキル識別子（kebab-case） | `nano-banana-pro-tips` |
| `description` | 説明文（用途・トリガー条件を含む） | `〜する際に使用` |

### description の書き方

Claude Codeがスキルを選択する際の判断材料になるため、以下を含める：

1. **何のスキルか**（簡潔に）
2. **いつ使うか**（トリガー条件）

```yaml
# 良い例
description: Nano Banana Pro活用術。文字描写・図解・写真合成のテクニックと、nano_banana.pyとの連携方法を参照する際に使用。

# 悪い例（トリガー条件がない）
description: 画像生成について
```

---

## カスタムコマンドとの違い

### カスタムコマンド（`.claude/commands/<name>.md`）

カスタムコマンドも同様にYAMLフロントマターを持ちますが、用途が異なります：

```yaml
---
description: コマンドの簡潔な説明
argument-hint: 引数を受け取る場合のヒント（オプション）
allowed-tools: [tool1, tool2]  # オプション
model: claude-haiku-4-5-20251001  # オプション
---

# 自然言語プロンプト
```

**引数の使い方**:
- プロンプト内で `$ARGUMENTS` プレースホルダーを使用
- 例: `/new-project brainbase` の場合、`$ARGUMENTS` は `brainbase` に置換される

```markdown
---
description: 新規プロジェクトを作成
argument-hint: <project-name>
---

$ARGUMENTS という名前のプロジェクトを作成してください。
```

### Skills vs カスタムコマンドの使い分け

| 項目 | Skills | カスタムコマンド |
|------|--------|----------------|
| 目的 | 知識・パターン・ベストプラクティス | ユーザー操作・ワークフロー |
| 参照 | Claudeが自動参照 | `/command` で明示的実行 |
| 関係 | 基礎知識レイヤー | Skills活用の上位レイヤー |
| 実行 | 暗黙的 | 明示的 |

**原則**: Skillsが先に必要。カスタムコマンドはSkillsを活用する。

---

## 作成手順

### 1. ディレクトリ作成

```bash
mkdir -p /Users/ksato/workspace/.claude/skills/{skill-name}
```

### 2. SKILL.md 作成

```bash
# 正本パスで作成
/Users/ksato/workspace/.claude/skills/{skill-name}/SKILL.md
```

### 3. README.md に追加

```markdown
# /Users/ksato/workspace/.claude/skills/README.md

| Skill | 用途 |
|-------|------|
| `{skill-name}` | {簡潔な説明} |
```

### 4. Skills数を更新

README.md最下部の `Skills数: N` を更新。

---

## 本文の推奨構成

```markdown
# スキル名

概要を1-2文で。

## 出典（あれば）

書籍名、URL、著者など。

## Triggers（必須）

以下の状況で使用：
- トリガー条件1
- トリガー条件2
- トリガー条件3

## 本文

内容をMarkdownで自由に記載。
- 見出し（##, ###）で構造化
- コードブロックで実例
- テーブルで比較・一覧

---

最終更新: YYYY-MM-DD
```

---

## 命名規則

| 項目 | ルール | 例 |
|------|--------|-----|
| ディレクトリ名 | kebab-case | `nano-banana-pro-tips` |
| `name` | ディレクトリ名と同じ | `nano-banana-pro-tips` |
| ファイル名 | 常に `SKILL.md` | - |

---

## カテゴリ（README.mdの分類）

| カテゴリ | 用途 |
|---------|------|
| brainbase運用 | タスク管理、RACI、KPI、Git運用など |
| マーケティング・営業 | フレームワーク、営業手法、コピーライティング |
| 経営・組織 | EOS、仕組み化、組織設計 |
| SaaS/プロダクト | ロードマップ、PM実践 |
| SNS運用 | 投稿ワークフロー、画像生成 |
| その他 | 上記に当てはまらないもの |

---

## ベストプラクティス（Anthropicガイドライン準拠）

### 1. 簡潔性（Conciseness）
- Claudeが既に知っている基本概念は説明不要
- brainbase固有の情報や実践的な内容に集中
- 冗長な説明を避け、実用性を重視

**良い例:**
```
## KPI計算
タスク一本化率 = (_tasks/index.md のタスク数) / (全タスク数) × 100%
```

**悪い例:**
```
KPIとは Key Performance Indicator の略で、組織の目標達成度を測定するための...（冗長）
```

### 2. 進歩的開示（Progressive Disclosure）
- SKILL.mdはインデックス/概要として機能
- 詳細な説明は別ファイルに分離可能
- 長大なスキル（500行超）は分割を検討

### 3. Triggersセクション（必須）
- スキル発見のための重要な手がかり
- 「以下の状況で使用：」形式で統一
- 具体的な使用場面を3つ程度記載

### 4. 命名規則
- **推奨**: Gerund形（動名詞）
  - 例: `managing-tasks`, `deploying-mana`, `creating-raci`
- **許容**: 名詞形（既存スキルとの一貫性優先）
  - 例: `task-format`, `raci-format`

### 5. 三人称記述
- 一人称（"I can help you"）を避ける
- 三人称（"Provides X when Y"）で記述
- 客観的・機能的な説明を心がける

### 6. 評価駆動開発
- **評価を先に作成**: 広範なドキュメントを書く前に、3つの評価シナリオを作成
- 実際の問題を解決しているか検証
- イテレーションで改善（使用→観察→改善）

### 7. ワークフローパターン
複雑な操作には明確な手順を提供：

````markdown
## 作業手順

以下のチェックリストをコピーして進捗を追跡：

```
進捗:
- [ ] ステップ1: データ収集
- [ ] ステップ2: 検証
- [ ] ステップ3: 実行
- [ ] ステップ4: 確認
```

**ステップ1: データ収集**
...

**フィードバックループ**: 検証スクリプトでエラーを早期発見
````

### 8. 用語の一貫性
- 1つの用語を全体で統一使用
- **良い例**: 常に「APIエンドポイント」
- **悪い例**: 「APIエンドポイント」「URL」「APIルート」を混在

## 共通パターン

### テンプレートパターン
厳格な出力形式が必要な場合、テンプレートを提供：

````markdown
## レポート構造

必ずこの形式を使用：

```markdown
# [タイトル]

## サマリー
[1段落の概要]

## 主要な発見
- 発見1
- 発見2
```
````

### 例示パターン
入力/出力ペアで期待される形式を明示：

````markdown
## コミットメッセージ形式

**例1:**
入力: ユーザー認証をJWTトークンで追加
出力:
```
feat(auth): JWT認証を実装

ログインエンドポイントとトークン検証ミドルウェアを追加
```
````

## アンチパターン（避けるべき）

### ❌ 時間依存情報
```markdown
# 悪い例
2025年8月以前は旧APIを使用

# 良い例
## 現在の方法
v2 APIを使用: `api.example.com/v2/messages`

## 旧パターン
<details>
<summary>v1 API（2025-08非推奨）</summary>
...
</details>
```

### ❌ 選択肢過多
```markdown
# 悪い例
pypdf、pdfplumber、PyMuPDF、pdf2image、または...

# 良い例
pdfplumberを使用：
（スキャンPDFの場合のみpdf2imageとpytesseractを使用）
```

### ❌ Windowsスタイルパス
```markdown
# 悪い例: scripts\helper.py
# 良い例: scripts/helper.py
```

---

## Orchestrator SkillとSubAgent

### 概要

複雑なワークフローを自動化するOrchestrator Skillは、SubAgentを呼び出して処理を分担します。

**重要な制約**:
- **Skill定義**: `.claude/skills/{skill-name}/SKILL.md`
- **SubAgent定義**: `.claude/agents/{agent-name}.md`（skillsの中ではない！）

```
.claude/
├── agents/                          # ← SubAgentはここに配置（必須）
│   ├── phase0-sync.md
│   ├── phase1-gather.md
│   └── phase2-process.md
├── skills/
│   └── my-orchestrator/
│       └── SKILL.md                 # Orchestrator定義
└── commands/
    └── my-command.md                # カスタムコマンド
```

### SubAgent定義（`.claude/agents/{name}.md`）

```yaml
---
name: phase0-sync
description: リポジトリとデータソースを同期。エラー時は詳細レポート出力。
tools: Bash, Read, Write
model: claude-sonnet-4-5-20250929
skills: git-workflow
---

You are a repository synchronization specialist.

When invoked:
1. Check git status
2. Pull latest changes
3. Report any issues

Output format:
- Sync completion log
- Any conflicts or issues
```

**SubAgentフロントマター**:

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `name` | Yes | 小文字とハイフンのみ（Task toolのsubagent_type用） |
| `description` | Yes | いつこのAgentを使うべきかの説明 |
| `tools` | No | カンマ区切りの利用可能ツール（省略時は全ツール継承） |
| `model` | No | モデル指定（inherit/sonnet/opus/haiku） |
| `skills` | No | 自動ロードするSkill名（カンマ区切り） |

### Orchestrator SkillからSubAgentを呼び出す

Orchestrator SKILL.md内で、Task toolを使ってSubAgentを呼び出します：

```markdown
## Phase 1: データ同期

Task toolで`phase0-sync` SubAgentを呼び出します：

- subagent_type: "phase0-sync"
- prompt: "全リポジトリを同期してください"
- description: "リポジトリ同期を実行"

期待される成果物:
- 同期完了ログ
- エラーレポート（あれば）
```

### 制約と注意点

| 制約 | 説明 |
|------|------|
| 配置場所 | SubAgentは必ず`.claude/agents/`に配置 |
| 命名規則 | 小文字とハイフンのみ（`phase0-sync`） |
| 自動検出 | セッション起動時のみ（新規追加後はセッション再開が必要） |
| 入れ子禁止 | SubAgent内から別SubAgentは呼べない |
| Skills継承 | デフォルトでは継承しない（明示的に`skills`フィールドで指定） |

### 実装チェックリスト

Orchestrator Skill作成時：
- [ ] SKILL.mdを`.claude/skills/{name}/`に作成
- [ ] SubAgentを`.claude/agents/`に作成（`.claude/skills/*/agents/`ではない！）
- [ ] SubAgentの`name`と`description`を明確に記述
- [ ] セッション再開でSubAgentが認識されることを確認
- [ ] Task tool経由で呼び出しテスト

---

## チェックリスト

### コア品質
- [ ] descriptionに具体的なキーワードとトリガー条件を含む
- [ ] Triggersセクションが記載されている（必須）
- [ ] SKILL.md本文が500行以内
- [ ] 追加詳細は別ファイルに分離（必要に応じて）
- [ ] 時間依存情報がない（または「旧パターン」セクションに）
- [ ] 用語が全体で統一されている
- [ ] 例が具体的（抽象的でない）
- [ ] 簡潔性の原則に従っている

### フォーマット
- [ ] ディレクトリ名がkebab-case
- [ ] `name`と`description`がフロントマターにある
- [ ] 三人称記述（"I can help"を避ける）
- [ ] Windowsスタイルパス（\\）を使用していない

### 登録
- [ ] README.mdの該当カテゴリに追加
- [ ] README.mdのSkills数を更新

### テスト
- [ ] 実際の使用シナリオでテスト済み
- [ ] 評価シナリオを作成（推奨3つ以上）

---

最終更新: 2025-12-26
