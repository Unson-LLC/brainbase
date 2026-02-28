---
name: skill-creator
description: ユーザーの指示や調査結果から新しいClaude Skillを自動作成・登録するメタスキル。「Skillsに登録しておいて」の一言で適切なSKILL.mdを生成し配置する。
---

# Skill作成支援スキル

## 目的

ユーザーが「これSkillsに登録しておいて」と指示するだけで、会話の文脈や調査結果から適切なClaude Skillを自動的に作成・登録します。

## 主な機能

1. **会話文脈からのSkill要件抽出**

   - 直前の作業内容・調査結果の分析
   - Skillとして保存すべき情報の特定
   - 再利用性の高い知識の抽出

2. **Skill名の自動提案**

   - kebab-case形式での命名
   - 内容を明確に表現する名前
   - 既存Skillsとの重複チェック

3. **SKILL.md自動生成**

   - YAML frontmatter（name, description）の作成
   - 目的・機能・使用方法の構造化
   - 具体的なコード例・コマンド例の含有
   - プロジェクト固有文脈の反映

4. **ファイル配置と登録**
   - `.claude/skills/{skill-name}/SKILL.md`への配置
   - `.claude/skills/README.md`の自動更新
   - `CLAUDE.md`への追記（必要に応じて）

## Claude Skillsの基本構造

### 必須要素

```markdown
---
name: your-skill-name # kebab-case形式
description: 簡潔な説明（Claude Codeが起動判定に使用）
---

# Your Skill Name

## 目的

このSkillの目的を明確に記述

## 主な機能

- 機能1
- 機能2
- 機能3

## 使用方法

具体的な使用例と呼び出し方

## コード例・コマンド例

実際に使えるコード・コマンドの記載
```

### ディレクトリ構造

```
.claude/skills/
├── README.md
├── skill-name/
│   └── SKILL.md
└── another-skill/
    └── SKILL.md
```

## Skill作成プロセス

### 1. 要件分析フェーズ

ユーザーの指示から以下を抽出：

- **対象範囲**: どの作業・知識をSkill化するか
- **目的**: なぜこのSkillが必要か
- **利用シーン**: どんな時に使うか
- **必要情報**: コマンド、コード、設定、手順など

### 2. Skill設計フェーズ

抽出した情報を基に設計：

```typescript
interface SkillDesign {
  name: string; // kebab-case
  description: string; // 1-2文の簡潔な説明
  purpose: string; // 目的の詳細説明
  features: string[]; // 主な機能リスト
  usageCases: string[]; // 使用例
  codeExamples: CodeExample[]; // コード例
  relatedDocs: string[]; // 関連ドキュメント
}

interface CodeExample {
  language: string; // typescript, bash, markdown等
  code: string; // 実際のコード
  description: string; // コードの説明
}
```

### 3. SKILL.md生成フェーズ

設計に基づいてSKILL.mdを生成：

```markdown
---
name: { 設計されたname }
description: { 設計されたdescription }
---

# {Skill名}

## 目的

{設計されたpurpose}

## 主な機能

{設計されたfeaturesを箇条書き}

## 使用方法

{使用例とシナリオ}

## コード例・コマンド例

{具体的なコード例}

## 関連ドキュメント

{関連ドキュメントへのリンク}
```

### 4. ファイル配置フェーズ

生成したSKILL.mdを配置：

```bash
# ディレクトリ作成
mkdir -p .claude/skills/{skill-name}

# SKILL.md配置
# （Write toolを使用）

# README.md更新
# （Edit toolを使用）
```

## 使用例

### パターン1: 直前の作業をSkill化

```
ユーザー: パスワードリセット機能の実装方法を調査して、こういう手順でやればいいことがわかった
ユーザー: これSkillsに登録しておいて

→ skill-creatorが起動
→ "password-reset-implementation" Skillを自動作成
→ 調査結果・手順・コード例を含むSKILL.mdを生成
```

### パターン2: 明示的なSkill化指示

```
ユーザー: Prismaマイグレーション作成の手順をSkillとして保存して

→ skill-creatorが起動
→ "prisma-migration-workflow" Skillを自動作成
→ マイグレーション手順・注意点・コマンド例を含むSKILL.mdを生成
```

### パターン3: トラブルシューティング結果の保存

```
ユーザー: このエラーの解決方法をSkillsに追加しておいて

→ skill-creatorが起動
→ エラー内容を分析し適切なSkill名を提案
→ 問題・原因・解決方法を含むSKILL.mdを生成
```

## Skill作成の判断基準

### Skill化すべき情報

- ✅ 再利用可能な手順・ワークフロー
- ✅ プロジェクト固有の設定・ルール
- ✅ 頻繁に参照する技術情報
- ✅ トラブルシューティング手順
- ✅ ベストプラクティス・チェックリスト

### Skill化不要な情報

- ❌ 一時的な調査結果
- ❌ 1回限りの作業内容
- ❌ 既存Skillsで十分カバーされる内容
- ❌ プロジェクト外で通用しない情報

## 自動生成時の品質保証

### 必須チェック項目

1. **YAML frontmatter**

   - `name`フィールドがkebab-case形式
   - `description`が具体的で簡潔（1-2文）

2. **内容の完全性**

   - 目的が明確に記述されている
   - 具体的なコード例・コマンド例が含まれている
   - 使用方法が実例付きで説明されている

3. **プロジェクト文脈**

   - SalesTailorプロジェクト固有の情報が反映
   - 既存の技術スタック・ルールとの整合性
   - 関連ドキュメントへの適切なリンク

4. **再利用性**
   - 他の開発者が理解できる説明
   - 十分な文脈情報の含有
   - 実行可能なコード・コマンド例

## 生成後の確認事項

### ファイル確認

```bash
# 生成されたSkillの確認
cat .claude/skills/{skill-name}/SKILL.md

# ディレクトリ構造確認
tree .claude/skills -L 2

# README.md更新確認
git diff .claude/skills/README.md
```

### 動作確認

次回Claude Code起動時に：

1. 新しいSkillが自動検出される
2. descriptionに基づいて適切なタイミングで起動される
3. Skill内の情報が正しく参照できる

## トラブルシューティング

### Skillが起動しない

**原因**: YAML frontmatterの形式エラー

**解決**:

```bash
# YAML検証
head -5 .claude/skills/{skill-name}/SKILL.md
```

正しい形式：

```yaml
---
name: skill-name
description: Description here
---
```

### descriptionが不適切

**症状**: 意図しないタイミングで起動する/全く起動しない

**解決**: descriptionを具体的かつ簡潔に修正

- ❌ 悪い例: "便利なSkill"
- ✅ 良い例: "Prismaマイグレーション作成時の手順とベストプラクティスを提供"

### 重複Skill名

**症状**: 既存Skillと名前が重複

**解決**: より具体的な名前に変更

```bash
# 既存Skill名の確認
ls .claude/skills/
```

## 高度な機能

### 1. 既存Skillの更新

既にあるSkillに情報を追加：

```
ユーザー: password-reset-implementation Skillに新しい手順を追加して

→ 既存SKILL.mdを読み込み
→ 新情報を適切なセクションに追加
→ SKILL.mdを更新
```

### 2. Skill間の関連付け

関連するSkills同士をリンク：

```markdown
## 関連Skill

- [Airtable要件同期](../airtable-requirement-sync/SKILL.md)
- [GitHub同期](../airtable-github-sync/SKILL.md)
```

### 3. Skillテンプレート

よく使うSkillパターンのテンプレート化：

- ワークフロー系Skill
- トラブルシューティング系Skill
- 設定・環境構築系Skill
- ベストプラクティス系Skill

## ベストプラクティス

### Skill命名規則

- **kebab-case必須**: `my-skill-name`
- **具体的**: `password-reset` より `password-reset-implementation`
- **動詞+名詞**: `create-migration`, `setup-environment`
- **プロジェクト名不要**: `salestailor-xxx`ではなく`xxx`

### description書き方

- **1-2文で完結**: 長すぎると起動判定が困難
- **具体的な機能**: 抽象的な表現は避ける
- **起動条件を含む**: "〜する時"、"〜を〜する"
- **対象を明確に**: 何に対する操作か明記

### 内容構成

1. **目的**: なぜこのSkillが存在するか
2. **主な機能**: 何ができるか（箇条書き）
3. **使用方法**: どう使うか（実例付き）
4. **コード例**: 実行可能なコード・コマンド
5. **トラブルシューティング**: よくある問題と解決策
6. **関連情報**: ドキュメント・他Skillへのリンク

## メタSkillとしての自己改善

このskill-creator自体も改善対象：

```
ユーザー: skill-creatorに新しい機能を追加して
- Skillテンプレート自動選択
- より高度なコード例生成
- Skill品質の自動評価

→ このSKILL.mdが更新される
→ skill-creator自身が進化する
```

## 実装例

### Skill作成フロー（TypeScript風擬似コード）

```typescript
async function createSkill(userRequest: string, conversationContext: string[]) {
  // 1. 要件抽出
  const requirements = await extractRequirements(
    userRequest,
    conversationContext,
  );

  // 2. Skill設計
  const design: SkillDesign = {
    name: suggestSkillName(requirements),
    description: generateDescription(requirements),
    purpose: extractPurpose(requirements),
    features: extractFeatures(requirements),
    usageCases: extractUsageCases(conversationContext),
    codeExamples: extractCodeExamples(conversationContext),
    relatedDocs: findRelatedDocs(requirements),
  };

  // 3. 既存Skill重複チェック
  const existingSkills = await listExistingSkills();
  if (existingSkills.includes(design.name)) {
    design.name = await resolveNameConflict(design.name);
  }

  // 4. SKILL.md生成
  const skillContent = generateSkillMarkdown(design);

  // 5. ファイル配置
  await createSkillDirectory(design.name);
  await writeSkillFile(design.name, skillContent);

  // 6. README更新
  await updateReadme(design);

  // 7. 確認
  return {
    skillName: design.name,
    filePath: `.claude/skills/${design.name}/SKILL.md`,
    message: `✅ Skill "${design.name}" を作成しました`,
  };
}
```

## 使用タイミング

このスキルは以下のフレーズで自動起動されます：

- "Skillsに登録しておいて"
- "これをSkillとして保存して"
- "新しいSkillを作って"
- "Skill作成して"
- "このやり方をSkillsに追加"

## 制限事項

- Claude Code再起動まで新Skillは有効化されない
- YAML形式エラーはClaude Code起動時にエラーとなる
- 既存Skill名との重複は手動解決が必要な場合あり

## 今後の拡張計画

- **AI支援テンプレート選択**: 内容から最適なテンプレート自動選択
- **Skill品質評価**: 生成したSkillの完成度自動評価
- **バージョン管理**: Skill更新履歴の管理
- **Skillカタログ**: チーム共有用Skillカタログ生成
