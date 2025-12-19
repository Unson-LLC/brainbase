---
name: people-meta
description: brainbaseにおける人物情報の登録・更新ルール。people.mdとpeople/*.mdの二層構造で管理。新規メンバー追加時に使用。
---

## Triggers

以下の状況で使用：
- 新規メンバーを追加するとき
- 人物情報を更新したいとき
- people.mdとpeople/*.mdのフォーマットを確認したいとき

# 人物情報（People）登録ルール

brainbaseにおける人物情報の標準フォーマットと運用ルールです。

## Instructions

### 1. 二層構造

人物情報は**2箇所に登録**する：

| ファイル | 役割 |
|---------|------|
| `_codex/common/meta/people.md` | サマリーテーブル（インデックス） |
| `_codex/common/meta/people/<person_id>.md` | 個別ファイル（詳細情報） |

**両方に登録すること。片方だけではNG。**

### 2. 個別ファイル（people/*.md）

#### ファイル名
- `<姓のローマ字>_<名のローマ字>.md`
- 例: `yamamoto_rikiya.md`, `mochida_sho.md`

#### フロントマター（必須）

```yaml
---
name: 山本 力弥
role: 代表理事 / CSO / 代表社員
org: 一般社団法人BAAO / 雲孫 / 合同会社ヤマリキエッジ
org_tags: [BAAO, 雲孫, ヤマリキエッジ]
projects: [baao, ncom, catalyst_program]
aliases: [山本力弥, Rikiya Yamamoto]
status: active
updated: 2025-12-02
---
```

| 項目 | 必須 | 説明 |
|------|------|------|
| name | ✅ | フルネーム（スペース区切り） |
| role | ✅ | 役職・役割 |
| org | ✅ | 所属組織（メイン） |
| org_tags | ✅ | 関連組織タグ（配列） |
| projects | ✅ | 担当プロジェクト（配列） |
| aliases | ✅ | 別名・英語名（配列） |
| status | ✅ | active / inactive / lead / stakeholder |
| updated | ✅ | 更新日 |
| assets | - | 資産・強み（任意） |
| scope | - | 権利の範囲（任意） |

#### 本文構造

```markdown
## 立ち位置 / 現在の役割
- 役職や立場を記載

## 担当 / 関連プロジェクト
- 担当プロジェクトを記載

## 連絡先（任意）
- Email: xxx@example.com
- Tel: 000-0000-0000

## メモ
- その他の情報
```

### 3. サマリーテーブル（people.md）

個別ファイルを作成したら、`people.md` のテーブルにも**1行追加**する。

```markdown
| 名前 | 役割 | 所属タグ | 主担当プロジェクト | 稼働ステータス | メモ |
| --- | --- | --- | --- | --- | --- |
| 持田 渉 | 執行役員（パートナー） | Tech Knight / リカルド | センパイナース | 稼働中 | リカルド執行役員。連絡先は個別ファイル参照。 |
```

### 4. 登録フロー

```
1. 個別ファイル作成: people/<person_id>.md
2. サマリー追加: people.md のテーブルに1行追加
3. プロジェクト更新: 関連プロジェクトの team[] に追加
```

### 5. ステータス定義

| status | 意味 |
|--------|------|
| active | 稼働中 |
| inactive | 非稼働・休止中 |
| lead | リード（見込み客側の人物） |
| stakeholder | ステークホルダー（直接稼働しないが関係者） |

## Examples

### 例: 業務委託メンバーの追加

**1. 個別ファイル: `people/mochida_sho.md`**

```yaml
---
name: 持田 渉
role: 執行役員（パートナー）
org: 株式会社リカルド
org_tags: [Tech Knight, リカルド]
projects: [senpainurse]
aliases: [持田渉, Mochida Sho]
status: active
updated: 2025-12-02
---

## 立ち位置
- 株式会社リカルド（Le caldo）執行役員
- センパイナース案件担当

## 担当
- センパイナース（退院支援AI）プロジェクト管理

## 連絡先
- Email: showmochida@lecaldo.co.jp
- Tel: 04-2968-6757
- Mobile: 090-8907-7532
```

**2. サマリー追加: `people.md`**

```markdown
| 持田 渉 | 執行役員（パートナー） | Tech Knight / リカルド | センパイナース | 稼働中 | リカルド執行役員。センパイナース担当。 |
```

**3. プロジェクト更新: `projects/techknight/senpainurse/project.md`**

```yaml
team: ['若松冬美', '持田渉']
```

### よくある失敗パターン

**❌ people.mdだけ更新**
```markdown
| 新人 | 開発 | ... |  # people/*.md がない
```
→ **修正**: 個別ファイルも作成

**❌ 個別ファイルだけ作成**
```
people/newperson.md  # people.md に追加してない
```
→ **修正**: サマリーテーブルにも追加

**❌ ファイル名が日本語**
```
people/山本力弥.md  # ❌
```
→ **修正**: ローマ字で `yamamoto_rikiya.md`

**❌ frontmatterの必須項目が欠落**
```yaml
---
name: 山本
# role, org_tags, projects, status が無い
---
```
→ **修正**: 必須項目をすべて記載

---

正本: `_codex/common/meta/people.md` + `_codex/common/meta/people/*.md`
