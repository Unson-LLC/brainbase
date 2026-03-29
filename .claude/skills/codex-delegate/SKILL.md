---
name: codex-delegate
description: Claude CodeからCodex execへタスクを委譲する。分析・コーディングをCodexに投げ、Claudeはマクロ判断に専念。
---

# Codex Delegate Skill

Claude Code（中間管理職）からCodex（作業者）へタスクを委譲するためのSkill。
Claudeのコンテキストを汚さず、問題と結果のみ保持してマクロ判断に専念する。

## 設計思想

```
ユーザー（社長）→ Claude（中間管理職）→ Codex（作業者）
```

- Claudeは問題定義・タスク分解・結果検証・次の判断
- Codexは分析・コーディング・リファクタリング等の実作業
- Codex作業中もClaudeはフリー（並列性）
- コンテキスト汚染を防ぎ、トークンを節約

## 呼び出しパターン

### 基本（同期・結果待ち）

```bash
BRAINBASE_SESSION_ID="$(tmux display-message -p '#S' 2>/dev/null)" \
  codex exec \
  -C "$(pwd)" \
  -o /tmp/codex-result.md \
  "タスク内容"
```

### バックグラウンド（非同期）

```bash
BRAINBASE_SESSION_ID="$(tmux display-message -p '#S' 2>/dev/null)" \
  codex exec \
  -C "$(pwd)" \
  -o /tmp/codex-result.md \
  "タスク内容" &
```

### JSONLストリーム（リアルタイム監視）

```bash
BRAINBASE_SESSION_ID="$(tmux display-message -p '#S' 2>/dev/null)" \
  codex exec \
  --json \
  -C "$(pwd)" \
  "タスク内容" > /tmp/codex-events.jsonl
```

## 使い方

### Step 1: 問題定義（Claudeが行う）
ユーザーの要求を分析し、Codexに投げるプロンプトを構成する。
プロンプトは具体的・明確に。Codexは対話できないのでワンショットで完結する指示にする。

### Step 2: Codex実行
上記パターンでcodex execを呼ぶ。

### Step 3: 結果検証（Claudeが行う）
`/tmp/codex-result.md` またはgit diffで結果を確認。
成功/失敗を判断し、次のアクション（追加修正、完了報告等）を決める。

## モデルと reasoning effort

デフォルト: `gpt-5.4` / reasoning effort `medium`

### reasoning effort レベル

| レベル | 用途 | 使う場面 |
|--------|------|----------|
| `low` | 最速・省トークン | 単純作業（フォーマット、ファイル整理） |
| `medium` | バランス型（デフォルト） | 通常のコーディング・修正タスク |
| `high` | 深い推論・高精度 | 分析タスク、バグ原因特定、アーキテクチャ判断 |

### 切り替え方

```bash
# 分析タスク → high
codex exec -c 'model_reasoning_effort="high"' "バグの原因を特定して"

# コーディング → medium（デフォルト、指定不要）
codex exec "この関数をリファクタリングして"

# 単純作業 → low
codex exec -c 'model_reasoning_effort="low"' "ファイルをフォーマットして"
```

## オプション早見表

| オプション | 用途 |
|-----------|------|
| `-C DIR` | 作業ディレクトリ指定 |
| `-o FILE` | 最後のメッセージをファイル出力 |
| `--json` | イベントをJSONLでstdout出力 |
| `-m MODEL` | モデル指定（デフォルト: gpt-5.4） |
| `-c 'model_reasoning_effort="X"'` | reasoning effort切り替え（low/medium/high） |
| `-s SANDBOX` | サンドボックスモード（read-only / workspace-write / danger-full-access） |
| `--full-auto` | 承認なし自動実行 + workspace-write sandbox |

## プロンプト設計のコツ

1. **ゴールを明確に** — 「何をどう変えるか」を具体的に
2. **制約を伝える** — 既存のアーキテクチャパターン、テスト要件等
3. **出力形式を指定** — 「変更したファイルの一覧と理由をmarkdownで出力せよ」等
4. **コミットさせない** — 変更はCodexに作らせ、コミットはClaudeが検証後に行う

## 注意事項

- `BRAINBASE_SESSION_ID` を渡さないと通知（codex-notify.sh）が発火しない
- codex execはconfig.tomlの `ask_for_approval = "never"` に従う（現在の設定）
- タイムアウトはBashツールの制限（最大10分）に注意。長いタスクはバックグラウンドで
- Codexにコミットさせない。変更検証後にClaudeまたはユーザーがコミットする
