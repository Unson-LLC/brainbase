---
name: sns-workflow
description: SNS投稿ワークフローのスクリプトパス・実行コマンド正本。画像生成（Nano Banana）・投稿実行のコマンドを参照する際に使用。
---

# SNS投稿スクリプト正本

SNS投稿に使用するスクリプトのパスと実行コマンドの正本。

## スクリプトパス（正本）

| スクリプト | パス |
|-----------|------|
| Nano Banana（画像生成） | `/Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py` |
| SNS投稿 | `/Users/ksato/workspace/_codex/common/ops/scripts/sns_post.py` |
| X OAuth2.0（ブックマーク等） | `/Users/ksato/workspace/_codex/common/ops/scripts/x_oauth2.py` |

## 画像生成コマンド

```bash
# テンプレート一覧
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py --list

# 画像生成
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py \
  -t <template> \
  "トピック" \
  "ポイント1" "ポイント2" "ポイント3"
```

テンプレート：

**従来型（情報整理向け）:**
- `infographic` - ビジネス図解
- `exploded` - 3D分解図
- `dashboard` - ダッシュボード
- `framework` - 概念図・フロー

**ど素人ホテル流（感情・プロセス向け）:**
- `progress` - 進捗/Before-After（プロセスエコノミー用）
- `incident` - 事件風サムネ（感情トリガー用）
- `poll` - 投票/アンケート（参加型用）
- `recovery` - V字回復ストーリー（失敗→回復用）

## 投稿コマンド

```bash
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/sns_post.py \
  --title "トピック要約" \
  --body "投稿本文" \
  --image <画像パス>
```

## 画像保存先

生成画像: `/Users/ksato/workspace/_codex/common/ops/_codex/sns/images/`

## 関連ファイル

| ファイル | 用途 |
|---------|------|
| `_codex/sns/sns_strategy_os.md` | 戦略・ポジショニング |
| `_codex/sns/rules.md` | ガードレール・フック例 |
| `_codex/sns/x_account_profile.md` | 人格・トンマナ定義 |
| `_codex/sns/post_log.md` | 投稿履歴 |
