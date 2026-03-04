---
name: agent-teams-validator
description: Agent Teams Skillの整合性を検証。SKILL.md frontmatterとagents/配下のname一致、余計なsuffix検出、ファイル名パターン確認を自動実行
category: dev_tech
tags: [agent-teams, validation, quality-check, hr-department]
primary_skill: true
---

# Agent Teams Validator Skill

**概要**: Agent Teams Skill（dev-ops, marketing-ops, ops-department等）の構造整合性を検証。hr-departmentで自動生成したSkillや、手動作成したSkillの品質チェックに使用。

**設計思想**: Agent Teams Skillは複雑な構造（SKILL.md frontmatter + agents/*.md）を持つため、name不一致やsuffix誤りが混入しやすい。このSkillで自動検証し、コマンド認識エラーを事前に防ぐ。

---

## Problem Statement

### 発生した問題（ops-department作成時）

hr-departmentのCode Generatorが生成したops-departmentのagent ファイルで、以下の不具合が発生：

```yaml
# SKILL.md frontmatter
teammates:
  - name: executive-assistant  # ← 正しい
    agentType: executive-assistant

# agents/executive_assistant.md frontmatter
name: executive-assistant-teammate  # ← `-teammate` が余計！
```

この不一致により、`/ops-department` コマンドが認識されず、Agent Teamsとして起動できなかった。

### 根本原因

1. **hr-departmentのCode Generator**: agent ファイル生成時に `-teammate` suffixを自動追加していた
2. **検証プロセス不在**: 生成後の整合性チェックが自動化されていなかった
3. **エラー検出の遅延**: コマンド実行時まで問題が発覚しなかった

---

## Validation Checklist

このSkillは以下の5項目を自動検証：

### ✅ Check 1: SKILL.md frontmatter に `teammates:` が存在

```bash
# SKILL.md に teammates: が定義されているか
grep -q "^teammates:" SKILL.md
```

**期待値**: Agent Teams SkillにはSKILL.md frontmatterに `teammates:` リストが必須

---

### ✅ Check 2: `agents/` ディレクトリが存在し、ファイルが存在

```bash
# agents/ ディレクトリが存在するか
[ -d "agents" ]

# teammates数とagent ファイル数が一致するか
teammates_count=$(grep -A 100 "^teammates:" SKILL.md | grep -c "  - name:")
agent_files_count=$(ls agents/*.md 2>/dev/null | wc -l)
[ "$teammates_count" -eq "$agent_files_count" ]
```

**期待値**: SKILL.md の teammates 数と agents/*.md ファイル数が一致

---

### ✅ Check 3: agent ファイルの `name:` が SKILL.md の `teammates[].name` と完全一致

```bash
# SKILL.md から teammates の name を抽出
teammates_names=$(grep -A 100 "^teammates:" SKILL.md | grep "  - name:" | sed 's/.*name: //')

# 各 agent ファイルの name を抽出
for file in agents/*.md; do
  agent_name=$(grep "^name:" "$file" | head -1 | sed 's/name: //')

  # teammates_names に含まれているか確認
  echo "$teammates_names" | grep -q "^$agent_name$"
done
```

**期待値**: 各agent ファイルの `name:` がSKILL.mdの `teammates[].name` リストに存在

---

### ✅ Check 4: 余計なsuffix（`-teammate` 等）が付いていないか

```bash
# agent ファイルの name に -teammate が含まれていないか
for file in agents/*.md; do
  agent_name=$(grep "^name:" "$file" | head -1 | sed 's/name: //')

  # -teammate suffix チェック
  if echo "$agent_name" | grep -q -- "-teammate$"; then
    echo "ERROR: $file has invalid suffix: $agent_name"
    exit 1
  fi
done
```

**期待値**: agent ファイルの `name:` に `-teammate` や `-agent` などの余計なsuffixが付いていない

---

### ✅ Check 5: ファイル名パターンが正しい（アンダースコア vs ハイフン）

```bash
# ファイル名（アンダースコア）と name（ハイフン）の対応確認
for file in agents/*.md; do
  basename=$(basename "$file" .md)  # executive_assistant
  agent_name=$(grep "^name:" "$file" | head -1 | sed 's/name: //')  # executive-assistant

  # アンダースコアをハイフンに変換して比較
  expected_name=$(echo "$basename" | tr '_' '-')

  if [ "$agent_name" != "$expected_name" ]; then
    echo "ERROR: Filename/name mismatch in $file"
    echo "  Expected: $expected_name"
    echo "  Actual:   $agent_name"
    exit 1
  fi
done
```

**期待値**: ファイル名（`executive_assistant.md`）と name（`executive-assistant`）が対応（アンダースコア→ハイフン変換で一致）

---

## Usage

### 手動実行（特定のAgent Teams Skill検証）

```bash
cd /Users/ksato/workspace/.claude/skills/ops-department
/Users/ksato/workspace/.claude/skills/agent-teams-validator/validate.sh
```

### Skill経由で実行

```javascript
Skill({ skill: "agent-teams-validator", args: "ops-department" })
```

**Output**:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Agent Teams Validator
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Target: ops-department

✅ Check 1: teammates: exists in SKILL.md
✅ Check 2: agents/ directory exists (3 files)
✅ Check 3: All agent names match teammates list
✅ Check 4: No invalid suffixes found
✅ Check 5: Filename patterns are correct

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Result: ✅ PASSED (5/5 checks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Fix Examples

### 問題: agent ファイルに `-teammate` suffix

```yaml
# ❌ 間違い
name: executive-assistant-teammate
```

**修正**:

```yaml
# ✅ 正しい
name: executive-assistant
```

### 問題: SKILL.md と agent ファイルのname不一致

```yaml
# SKILL.md
teammates:
  - name: exec-assistant  # ← 短縮形

# agents/executive_assistant.md
name: executive-assistant  # ← フル名
```

**修正**: どちらかに統一

```yaml
# Option 1: フル名に統一（推奨）
# SKILL.md
teammates:
  - name: executive-assistant

# agents/executive_assistant.md
name: executive-assistant
```

---

## Integration with hr-department

hr-departmentのCode Generatorが生成したSkillを自動検証する流れ：

```
hr-department
  ↓ Code Generator
Agent Teams Skill生成
  ↓
agent-teams-validator
  ↓ 5 Checks
✅ PASSED or 🔴 FAILED
  ↓（FAILED時）
手動修正 or Code Generator再実行
```

**提案**: hr-departmentのPhase 3（Code Generation）完了後、自動的にagent-teams-validatorを実行

---

## Known Issues（hr-departmentのバグ）

### Issue 1: `-teammate` suffix自動追加

**発生箇所**: hr-departmentのCode Generator

**原因**: agent ファイルのテンプレートで以下のように生成：

```yaml
name: {{ teammate.name }}-teammate
```

**修正方法**: Code Generatorのテンプレートから `-teammate` を削除

```yaml
# 修正前
name: {{ teammate.name }}-teammate

# 修正後
name: {{ teammate.name }}
```

---

## Success Criteria

- [ ] 5つのチェックすべてがPASSED
- [ ] SKILL.md の `teammates[].name` と agents/*.md の `name:` が完全一致
- [ ] 余計なsuffix（`-teammate`, `-agent`）が存在しない
- [ ] ファイル名パターン（アンダースコア）とname（ハイフン）が対応
- [ ] `/skill-name` コマンドとして認識される

---

## Related Skills

| Skill | 関連 |
|-------|------|
| **hr-department** | Agent Teams Skillの自動生成元（このvalidatorで検証） |
| **dev-ops** | 参照実装（正しいAgent Teams構造の例） |
| **marketing-ops** | 参照実装 |
| **ops-department** | このvalidatorで修正した実例 |

---

## Notes

- **適用タイミング**: Agent Teams Skill作成直後、または `/skill-name` コマンドが認識されないとき
- **検証範囲**: SKILL.md frontmatter + agents/*.md のみ（Skills/Primary Skillの妥当性は検証しない）
- **エラー時の対応**: validators出力に従って手動修正 or hr-department再実行
- **今後の改善**: hr-departmentのCode Generatorに組み込み、生成時点で検証

---

## Version

- **Current**: 1.0.0
- **Last Updated**: 2026-02-09
- **Author**: Claude Code (ops-department作成時の学習から抽出)

---

最終更新: 2026-02-09
