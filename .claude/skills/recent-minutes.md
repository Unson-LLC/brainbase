---
name: recent-minutes
description: 直近の議事録を確認（プロジェクト指定可、最新3件表示・選択可）
user_invocable: true
display_name: 📋 直近議事録確認
---

# 直近議事録確認

指定プロジェクトの直近の議事録を自動的に見つけて表示するスキル。

## 使い方

```
/recent-minutes [プロジェクト名] [件数]
```

- プロジェクト名: 省略時は現在のworktreeプロジェクト（unson, salestailor, tech-knight等）
- 件数: 表示する議事録の数（省略時は3件）

## 実行手順

### 1. 最新状態に更新

```bash
git pull --rebase origin main
```

git pullに失敗した場合は、divergent branchesエラーの可能性があるため `--rebase` を使用。

### 2. プロジェクトのmeetingsディレクトリを特定

現在のworktreeディレクトリ構造:
- `./meetings/[category]/minutes/*.md` - 議事録
- `./meetings/[category]/transcripts/*.txt` - 文字起こし

カテゴリ例: `unson-board`, `mywa`, `other`, `dialogai`, `yakumokai`, 等

### 3. 最新の議事録を取得

```bash
find ./meetings -path "*/minutes/*.md" -type f -exec stat -f "%m %N" {} \; | sort -rn | head -n [件数] | cut -d' ' -f2-
```

- `-exec stat -f "%m %N"`: ファイルの更新時刻とパスを取得
- `sort -rn`: 更新時刻の降順でソート
- `head -n [件数]`: 指定件数だけ取得
- `cut -d' ' -f2-`: パスのみ抽出

### 4. ファイルリストを表示して選択

ユーザーに最新N件のファイルリストを表示し、確認したい議事録を選択させる。

表示形式例:
```
直近の議事録 (3件):

1. 2025-12-29: ai-development-progress-discussion
   ./meetings/unson-board/minutes/2025-12-29_ai-development-progress-discussion.md

2. 2025-12-22: security-incident-project-discussion
   ./meetings/unson-board/minutes/2025-12-22_security-incident-project-discussion.md

3. 2025-12-22: planna-ceo-recruitment-discussion
   ./meetings/unson-board/minutes/2025-12-22_planna-ceo-recruitment-discussion.md

どれを確認しますか？(1-3、または all)
```

### 5. 選択された議事録を読み込み

Readツールで該当ファイルを読み込み、以下の情報を抽出して表示:

- **会議名**: ファイル名から抽出
- **日付**: front matterまたはファイル名から
- **要約**: 議事録内の要約セクション
- **アクションアイテム**: 📅セクションまたは「次の手配・アクション」セクション

全文表示が必要な場合は、ファイル全体を表示。

## 出力フォーマット

```markdown
## [日付] [会議名]

**ファイル**: [相対パス]
**コミット**: [最新コミットハッシュ] "[コミットメッセージ]"

### 要約
[要約内容]

### アクションアイテム (N件)
- [ ] [アクション1] (担当: xxx, 期限: xxx)
- [ ] [アクション2] (担当: xxx, 期限: xxx)
...

[詳細を表示しますか？の確認]
```

## エラーハンドリング

- `git pull` 失敗時: エラーメッセージを表示し、手動での対処を促す
- 議事録が見つからない場合: 「指定プロジェクトの議事録が見つかりません」と表示
- ファイル読み込みエラー: ファイルパスとエラー内容を表示

## 関連情報

- 議事録テンプレート: `_codex/common/templates/meeting_template.md`
- 会議記録の配置ルール: `_codex/common/architecture_map.md`
