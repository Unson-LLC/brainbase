# Skills自動学習 - クイックスタート

brainbaseのSkillsが実行経験から自動的に進化する仕組みです。

## 🚀 使い方（3ステップ）

### ステップ1: 普通にAgentを使う

```
ユーザー: 01_strategyを作成してください
Claude: （strategy-template Skillを使って作成）
```

**裏で自動実行**:
```bash
→ tool-result.sh が実行内容をキャプチャ
→ 学習候補として保存
💡 学習候補を検出: strategy-template
```

### ステップ2: 自動通知を待つ

3件の学習候補が溜まると、**次回のプロンプト送信時に自動通知**：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 Skills学習候補: 3 件
━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • Skill: strategy-template
  • Skill: task-format
  • Skill: raci-format

💡 自動分析を開始する場合: /learn-skills
━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### ステップ3: 承認する（ワンクリック）

```
ユーザー: /learn-skills

Claude: 
━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 更新案 #1732534800

Skill: strategy-template
更新内容: 定量性チェック項目を追加
信頼度: 85%

承認コマンド: /approve-skill 1732534800
━━━━━━━━━━━━━━━━━━━━━━━━━━━

ユーザー: /approve-skill 1732534800

Claude:
✅ Skills更新を適用しました！
次回から、このSkillを使用する際に新しい内容が反映されます。
```

---

## 📊 動作フロー

```
┌────────────────────┐
│ 1. Agent実行       │ ✅ 完全自動
│   （tool-result）   │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 2. 学習候補蓄積    │ ✅ 完全自動
│   （3件で通知）     │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 3. 自動通知        │ ✅ 完全自動
│   （プロンプト時）  │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 4. /learn-skills   │ ⚡ ワンコマンド
│   （分析・提案）    │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 5. /approve-skill  │ ⚡ ワンクリック承認
│   （自動適用）      │
└────────────────────┘
```

---

## 🔍 学習対象

| 操作 | 検出対象Skill | 学習内容 |
|------|--------------|---------|
| 01_strategy作成 | `strategy-template` | 新チェック項目、ベストプラクティス |
| タスク追加 | `task-format` | 新フォーマット、必須項目 |
| RACI定義 | `raci-format` | 新パターン、典型的な役割分担 |
| _codex検証 | `codex-validation` | 新検証項目、エラーパターン |
| Knowledge Skill追加 | `knowledge-frontmatter` | フロントマター項目 |

---

## 🔒 安全性

- ✅ **ユーザー承認必須**: 自動更新は行わない
- ✅ **自動バックアップ**: 更新前の状態を保存
- ✅ **ロールバック可能**: いつでも元に戻せる
- ✅ **履歴記録**: すべての更新を記録

---

## 📁 ファイル構造

```
.claude/
├── hooks/
│   ├── tool-result.sh              # 実行内容キャプチャ
│   └── user-prompt-submit.sh       # 自動通知
│
├── learning/
│   ├── execution_logs/             # 実行ログ
│   ├── learning_queue/             # 学習候補
│   ├── skill_updates/              # 更新案
│   ├── history/                    # 更新履歴
│   │   └── backups/               # バックアップ
│   └── scripts/
│       ├── auto_learn.sh          # 自動分析
│       └── apply_update.sh        # 更新適用
│
└── commands/
    ├── learn-skills.md            # 学習実行
    └── approve-skill.md           # 承認
```

---

## 💡 Tips

### 学習を無効化したい場合

```bash
# Hookを一時的に無効化
chmod -x .claude/hooks/tool-result.sh

# 再度有効化
chmod +x .claude/hooks/tool-result.sh
```

### 学習候補をクリア

```bash
# 全学習候補を削除
rm -f .claude/learning/learning_queue/*.json
```

### 履歴を確認

```bash
# 今日の更新履歴を確認
cat .claude/learning/history/$(date +%Y-%m-%d).md
```

---

これで、brainbaseのSkillsが**あなたの使い方から自動的に学習・進化**します！
