---
name: knowledge-frontmatter
description: Claude Skillsの登録フォーマットと作成手順。新規Skillを.claude/skills/に追加する際に使用。
---

# Claude Skills 登録ガイド

brainbaseにおけるClaude Skills（`.claude/skills/*/SKILL.md`）の作成手順と標準フォーマット。

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

## Triggers（任意）

以下の状況で使用：
- トリガー条件1
- トリガー条件2

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

## チェックリスト

新規Skill作成時の確認事項：

- [ ] ディレクトリ名がkebab-case
- [ ] `name`と`description`がフロントマターにある
- [ ] `description`にトリガー条件が含まれている
- [ ] README.mdの該当カテゴリに追加
- [ ] README.mdのSkills数を更新

---

最終更新: 2025-12-09
