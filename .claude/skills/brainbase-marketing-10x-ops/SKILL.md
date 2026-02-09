---
name: brainbase-marketing-10x-ops
description: brainbaseのマーケ10倍運用で、正本（SSOT）・作業場所・成果物の保存先・運用ループ・NocoDB運用の管理場所を定義する。議事録からPillar抽出〜X/note/X記事の出荷管理までの手順を短く固定する。
---

# brainbase Marketing 10x Ops

## 目的
- 10倍運用の「作業場所/成果物/SSOT」を迷わず固定する
- 迷いが出やすい「noteとX記事の正本」「議事録の参照場所」を明示する

## 正本（SSOT）
- **運用状態の正本**: NocoDB（Brainbase）
- **ガードレールの正本**: `_codex/sns/`
- **議事録の正本**: `config.yml` の `projects[*].local.path` 配下の `meetings/minutes/`

## 管理場所（成果物の保存先）
- **長文の正本（note & X記事共通）**:
  - `_codex/sns/drafts/{topic}_final.md`
- **状態・出荷管理**:
  - NocoDB `Content`（1レコード=1チャンネル=1出荷物）
  - noteとX記事は別レコード、同一Pillar参照
- **週次ログ**（任意）:
  - `_codex/sns/log/`

## 参照するガードレール
必要に応じて以下を読む（コピーしない）:
- `_codex/sns/sns_strategy_os.md`
- `_codex/sns/rules.md`
- `_codex/sns/style_guide.md`
- `_codex/sns/x_account_profile.md`
- `_codex/common/00_stories.md` の E0-002

## 議事録の取り出し方（Pillar抽出）
- `config.yml` を読み、`projects[*].local.path` を列挙
- 各 `meetings/minutes/` の最新ファイルを読む
- 直近3〜5件からPillarを3本抽出

## 出荷フロー（最短）
1) **Pillar決定**（3本）
2) **note-smart**で長文生成 → `_codex/sns/drafts/{topic}_final.md`
3) **X記事は同一本文で出荷**（noteと同じ）
4) **X短文**は各Pillarから10本ずつ（合計30本/日）
5) NocoDBに `Content` を起票し `status` を進める

## X記事の公開（Playwright/Python）
**原則: 編集URL指定で実行（同名下書きの取り違え防止）**

### 0) 5:2ヘッダー画像を生成（nano_banana.py）
```bash
/Users/ksato/workspace/.venv/bin/python \
  /Users/ksato/workspace/_codex/common/ops/scripts/nano_banana.py \
  -p "Create a clean Japanese business framework banner for an X Article header. Aspect ratio 5:2 (e.g., 1500x600). Title text in Japanese: {topic}. Show exactly 3 short points in Japanese from {points_text} with small icons and numbered labels 1-3. Keep text large and legible, high contrast, ample whitespace, professional blue/gray palette with one accent color. Horizontal banner composition, no extra logos, no dense paragraphs, no English text." \
  -o /Users/ksato/workspace/_codex/sns/images/x_article_YYYYMMDD_5x2.jpg \
  "タイトル" "ポイント1" "ポイント2" "ポイント3"
```

### 1) Chrome起動（ログイン保持）
```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome-X-Article"
```

### 2) 画像挿入 + 公開（画像必須チェック付き）
```bash
python3 shared/_codex/common/ops/scripts/x_article_post.py \
  /path/to/draft.md \
  --edit-url "https://x.com/compose/articles/edit/xxxxxxxxxxxxxxxx" \
  --connect-cdp http://127.0.0.1:9222 \
  --image /path/to/header.jpg \
  --require-image \
  --publish
```

### 3) 画像挿入だけ（公開しない）
```bash
python3 shared/_codex/common/ops/scripts/x_article_post.py \
  --edit-url "https://x.com/compose/articles/edit/xxxxxxxxxxxxxxxx" \
  --connect-cdp http://127.0.0.1:9222 \
  --image /path/to/header.jpg \
  --require-image \
  --dry-run \
  --skip-fill
```

## NocoDBの最低要件
- `Content` に `owner_person` / `reviewer_person` を必須
- `status` は編集パイプライン専用: `draft → review → scheduled → published → archived`
- `primary_channel` は単一選択
- `repurpose_status` / `measured_24h_at` / `measured_7d_at` は別フラグ

## ルール（失敗防止）
- noteとX記事は**同一本文**でよい（内容の正本はnote側）
- X短文は必ず「OSのどこが変わるか」を1行入れる
- AIの生成だけ増やさない。**出荷数のみをKPIとする**

## 使い分け
- **note記事作成**: note-smart
- **X短文量産**: sns-smart

## コマンド（任意）
- People同期: `/Users/ksato/workspace/shared/_codex/common/ops/scripts/sync_people_all.sh`
