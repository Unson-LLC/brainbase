# 学習候補の確認・適用

セッション履歴から自動抽出された学習候補を確認し、brainbaseのナレッジに反映します。

## 実行手順

1. `.claude/learning/learning_queue/` の候補を読み込む
2. 各候補の内容を表示
3. 適用先を判断して提案
4. ユーザー承認後に適用

## 学習候補の確認

まず学習キューの内容を確認してください：

```bash
ls -la /Users/ksato/workspace/.claude/learning/learning_queue/
```

各候補ファイル（`candidate_*.json`）を読み込んで、以下の形式で表示してください：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 学習候補レビュー
━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 候補 #1: [title]
カテゴリ: [category]
信頼度: [confidence]
タグ: [tags]

### 学習内容
[content]

### 提案される適用先（カテゴリ別）

**navigation/shortcut/gotcha/config** → スキルに追加
- [ ] .claude/skills/[既存skill]/SKILL.md を更新
- [ ] .claude/skills/[新規skill]/SKILL.md を新規作成

**プロジェクト固有の学習** → プロジェクトに追加
- [ ] _codex/projects/[project]/project.md に反映

**ドキュメントの誤り** → 元ファイルを直接修正
- [ ] [該当ファイル] のパス・内容を修正

※ `_codex/sources/` は外部参照情報専用のため学習先には使用しない

### アクション
- 適用する場合: 「候補#1を適用」と入力
- スキップする場合: 「候補#1をスキップ」と入力
- 削除する場合: 「候補#1を削除」と入力

━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 適用処理

ユーザーが「適用」を選んだ場合：

1. 適用先ファイルを確認・編集
2. 候補ファイルを `.claude/learning/history/` に移動（完了マーク）
3. 変更をコミット

## 手動抽出の実行

新しい学習候補を手動で抽出したい場合：

```bash
/Users/ksato/workspace/_codex/common/ops/scripts/extract-learnings.sh
```

これは通常6時間ごとに自動実行されますが、手動でも実行できます。

## 自動抽出の仕組み

```
~/.claude/projects/-Users-ksato-workspace/*.jsonl
        │
        ▼ 6時間ごと（launchd）
┌─────────────────────────────────────┐
│ extract-learnings.sh                │
│   │                                 │
│   ├─ 未処理のtranscriptを取得       │
│   ├─ tmuxでClaude起動（Max plan内） │
│   ├─ 会話内容を分析                 │
│   └─ 学習候補をJSON保存             │
└─────────────────────────────────────┘
        │
        ▼
.claude/learning/learning_queue/*.json
        │
        ▼ /learn-skills
ユーザーレビュー → 承認 → brainbase反映
```

## launchdサービスの管理

```bash
# インストール
ln -sf /Users/ksato/workspace/_codex/common/ops/launchd/com.brainbase.extract-learnings.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.brainbase.extract-learnings.plist

# ステータス確認
launchctl list | grep brainbase

# 手動実行
launchctl start com.brainbase.extract-learnings

# アンインストール
launchctl unload ~/Library/LaunchAgents/com.brainbase.extract-learnings.plist
```

---

学習キューを確認して、候補を表示してください。
