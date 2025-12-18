# Skills 自動学習アーキテクチャ

Agentの実行内容からSkillsを自動的に学習・更新する仕組み。

## 🎯 目的

1. **差分検出**: Agent実行内容とSkillsの内容に差分があれば検出
2. **自動学習**: 実行ログから新しいパターンを抽出
3. **Skills進化**: 検出された差分を元にSkillsを自動更新

---

## 🏗️ アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│  1. 実行フェーズ（Hooks）                                 │
│  ├─ tool-result.sh                                       │
│  │   └─ Agent実行内容をキャプチャ                        │
│  │   └─ 実行ログを保存                                   │
│  └─ 学習キューに追加                                     │
└─────────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│  2. 差分検出フェーズ（自動/手動）                         │
│  ├─ 実行ログ vs Skills比較                              │
│  ├─ パターン差分を抽出                                   │
│  └─ 学習候補を生成                                       │
└─────────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│  3. 学習プロセス（Subagent: skills-learner）             │
│  ├─ 学習候補を分析                                       │
│  ├─ 新規Skill or 既存Skill更新を判断                    │
│  ├─ 更新案を生成                                         │
│  └─ ユーザー承認待ち                                     │
└─────────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│  4. 承認・適用フェーズ                                   │
│  ├─ ユーザーが更新案をレビュー                           │
│  ├─ 承認されたらSkillsを更新                            │
│  └─ 更新履歴を記録                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 📂 ディレクトリ構造

```
.claude/
├── hooks/
│   ├── tool-result.sh              # 実行内容をキャプチャ
│   └── user-prompt-submit.sh       # 学習トリガー検出
│
├── learning/
│   ├── execution_logs/             # 実行ログ
│   │   └── YYYY-MM-DD_HH-MM-SS.json
│   ├── learning_queue/             # 学習キュー
│   │   └── candidate_*.json
│   ├── skill_updates/              # 更新案
│   │   └── update_*.json
│   └── history/                    # 更新履歴
│       └── YYYY-MM-DD.md
│
├── skills/                         # 既存Skills
│   └── .../SKILL.md
│
└── commands/
    └── learn-skills.md             # 学習実行コマンド
```

---

## 🔄 フロー詳細

### Phase 1: 実行ログキャプチャ（Hooks）

**tool-result.sh**:
```bash
# Agent実行時に自動実行
if [[ "$TOOL" == "Write" || "$TOOL" == "Edit" ]]; then
  # 実行内容をJSON形式で保存
  cat > ".claude/learning/execution_logs/$(date +%Y-%m-%d_%H-%M-%S).json" <<EOF
{
  "timestamp": "$(date -Iseconds)",
  "tool": "$TOOL",
  "params": $PARAMS,
  "user_prompt": "$LAST_USER_MESSAGE",
  "result": "$RESULT"
}
EOF
fi
```

### Phase 2: 差分検出

**差分検出ロジック**:
```bash
# 実行ログからパターンを抽出
USER_PROMPT="01_strategyを作成してください"
EXECUTION="strategy-template Skillを使って作成"

# Skills内容と比較
SKILL_CONTENT=$(cat .claude/skills/strategy-template/SKILL.md)

# 差分を検出
if [[ "$EXECUTION" != *"$SKILL_CONTENT"* ]]; then
  # 学習候補として保存
  echo "差分検出: strategy-template"
fi
```

### Phase 3: 学習プロセス（Subagent）

**skills-learner Subagent**:
```markdown
あなたはSkills学習エージェントです。以下を実行してください：

1. 実行ログを分析
2. 既存Skillsと比較
3. 以下を判断：
   - 新規Skill作成が必要か？
   - 既存Skillの更新が必要か？
   - 学習不要か？
4. 更新案を生成（YAML + Markdown）
5. ユーザー承認を求める
```

### Phase 4: 承認・適用

**更新案の例**:
```json
{
  "type": "update",
  "skill": "strategy-template",
  "reason": "実行時に新しいベストプラクティスが発見されました",
  "diff": {
    "added": [
      "## Instructions",
      "### 6. 新しいチェック項目",
      "- KPIが定量的か確認"
    ],
    "removed": []
  },
  "confidence": 0.85
}
```

---

## 🛠️ 実装コンポーネント

### 1. Hooks

**`.claude/hooks/tool-result.sh`**:
- Agent実行内容をキャプチャ
- 実行ログをJSON形式で保存
- 学習対象となるツール: Write, Edit, Read（特定パターン）

**`.claude/hooks/user-prompt-submit.sh`**:
- ユーザー指示に「学習」キーワードが含まれるか検出
- 学習モードのトリガー

### 2. カスタムコマンド

**`/learn-skills`**:
- 手動で学習プロセスを実行
- 学習キューを処理
- 更新案を生成・提示

**`/approve-skill <update_id>`**:
- 更新案を承認
- Skillsを自動更新
- 履歴を記録

**`/reject-skill <update_id>`**:
- 更新案を却下
- 学習キューから削除

### 3. Subagent

**`skills-learner`**:
- 実行ログから新パターンを学習
- 既存Skillsとの差分を分析
- 更新案を生成

**`skills-validator`**:
- 更新されたSkillsの検証
- フロントマターの正当性チェック
- 矛盾がないか確認

### 4. スクリプト

**`.claude/learning/scripts/detect_diff.sh`**:
- 実行ログとSkillsの差分検出

**`.claude/learning/scripts/generate_update.sh`**:
- 更新案のJSON生成

**`.claude/learning/scripts/apply_update.sh`**:
- 承認された更新案を適用

---

## 📊 学習候補の優先度

| 優先度 | 条件 | 例 |
|-------|------|-----|
| **高** | 同じパターンが3回以上出現 | strategy作成で毎回同じ手順を実行 |
| **中** | 新しいベストプラクティスが発見 | より効率的な方法を実行 |
| **低** | 一度だけの特殊ケース | プロジェクト固有の対応 |

---

## 🔒 安全性担保

1. **ユーザー承認必須**: 自動更新は行わず、必ずユーザーが承認
2. **バージョン管理**: 更新前のSkillsをバックアップ
3. **差分表示**: 何が変わるのか明示
4. **ロールバック機能**: 承認後も元に戻せる

---

## 📈 学習メトリクス

- **学習候補数**: 検出された差分の数
- **承認率**: 承認された更新案 / 全更新案
- **適用率**: 実際に適用された更新 / 承認された更新
- **Skills成長率**: 新規追加・更新されたSkills数

---

## 🎯 使用例

### 例1: 新しいベストプラクティスを学習

**ユーザー操作**:
```
ユーザー: 01_strategyを作成してください
Claude: strategy-template Skillを使って作成します
        （実行）
        ※ 実行時に新しいチェック項目を追加
```

**自動学習**:
```bash
# tool-result.sh が検出
差分検出: strategy-template に新しいチェック項目が追加されました

# 学習候補として保存
.claude/learning/learning_queue/candidate_001.json
```

**ユーザー承認**:
```
Claude: 📚 学習候補が見つかりました

## 更新案: strategy-template
新しいチェック項目を追加：
- KPIが定量的か確認

この更新を承認しますか？ /approve-skill 001
```

### 例2: 新規Skillを学習

**ユーザー操作**:
```
ユーザー: プロジェクトのREADMEを作成してください
Claude: （実行）
        ※ 既存Skillsにないパターン
```

**自動学習**:
```bash
# 新規Skill候補として保存
.claude/learning/learning_queue/candidate_002.json
{
  "type": "new",
  "suggested_name": "project-readme",
  "description": "プロジェクトREADME作成の標準テンプレート",
  "extracted_pattern": "..."
}
```

---

## 🚀 実装優先順位

### Phase 1: 基礎（即座に実装）
1. ✅ tool-result.sh Hook（実行ログキャプチャ）
2. ✅ 学習キューディレクトリ作成
3. ✅ 差分検出スクリプト

### Phase 2: 学習（1週間以内）
4. ⏳ skills-learner Subagent
5. ⏳ /learn-skills カスタムコマンド
6. ⏳ 更新案生成ロジック

### Phase 3: 承認・適用（2週間以内）
7. ⏳ /approve-skill / /reject-skill コマンド
8. ⏳ 更新適用スクリプト
9. ⏳ 履歴記録

---

このアーキテクチャに従うことで、brainbaseのSkillsが**自動的に進化**し、Agentの実行品質が継続的に向上します。
