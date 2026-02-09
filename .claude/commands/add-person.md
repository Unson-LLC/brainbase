# 人物登録コマンド /add-person

`_codex/common/meta/` 配下に人物情報を一括登録する。3ファイルを自動更新。

## 引数

`$ARGUMENTS`: 以下の形式で指定

```
<名前> --org <組織名> [--role <役割>] [--project <プロジェクトID>] [--status <ステータス>]
```

### 必須
- `<名前>`: フルネーム（例: 上野 隆功）
- `--org`: 所属組織（例: 日本スキンケア協会）

### オプション
- `--role`: 役割（デフォルト: Other）
- `--project`: 関連プロジェクト（デフォルト: なし）
- `--status`: active / inactive / lead / stakeholder（デフォルト: lead）
- `--memo`: メモ（デフォルト: なし）

## 使用例

```bash
# 基本
/add-person 上野 隆功 --org 日本スキンケア協会

# フルオプション
/add-person 上野 隆功 --org 日本スキンケア協会 --role 紹介者 --project baao_training --status lead --memo "SES会社向けAI研修の紹介者"
```

## 実行手順

### 1. 引数のパース

名前と各オプションを抽出：
- 名前 → ファイル名用にローマ字変換（例: 上野 隆功 → ueno_takanori）
- 組織名 → organizations.md 登録チェック用

### 2. ファイル名の生成

名前をローマ字に変換してファイル名を決定：
- スペース → アンダースコア
- 小文字
- 例: `ueno_takanori.md`

**ローマ字変換の確認**:
- ユーザーに「ファイル名は `<ローマ字>.md` でよいですか？」と確認
- 異なる場合は修正を受け付ける

### 3. organizations.md の確認・追加

`_codex/common/meta/organizations.md` を確認：
- 指定された組織が登録されていない場合 → 追加を提案
- 登録済みの場合 → スキップ

**追加フォーマット**:
```markdown
| <組織名> | <組織名>（仮） | リード | <名前>が所属。 |
```

### 4. people/<person_id>.md の作成

`_codex/common/meta/people/<person_id>.md` を作成：

```yaml
---
name: <名前>
role: <役割>
org: <組織名>
org_tags: [<組織名>]
projects: [<プロジェクトID>]
aliases: [<名前スペースなし>, <ローマ字>]
status: <ステータス>
updated: <今日の日付>
---

## 現在の役職
- <組織名> <役割>

## メモ
- <memo>
```

### 5. people.md にサマリー追加

`_codex/common/meta/people.md` のテーブル末尾（※所属タグは...の前）に1行追加：

```markdown
| <名前> | <役割> | <組織名> | <プロジェクト> | <ステータス日本語> | <memo> |
```

**ステータス日本語変換**:
- active → 稼働中
- inactive → 非稼働
- lead → リード
- stakeholder → ステークホルダー

### 6. 完了報告

作成・更新したファイルを一覧表示：

```
✅ 人物登録完了: <名前>

更新ファイル:
1. people/<person_id>.md（新規作成）
2. people.md（1行追加）
3. organizations.md（組織追加 ※該当時のみ）

次のアクション:
- コミットする場合: /commit
- プロジェクトのteam[]に追加する場合: _codex/projects/<project>/project.md を編集
```

## 注意事項

- 同名のファイルが既に存在する場合はエラー（上書きしない）
- ローマ字変換は自動推測、確認を挟む
- organizations.md への追加は「リード」タイプで仮登録（後で修正可能）

## 参照Skill

詳細ルールは `data-meta-guide` を参照：
- § 1 人物情報管理
- § 2 顧客情報管理
