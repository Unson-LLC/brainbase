---
name: brainbase-content-ssot
description: brainbaseでnote/X Article/X投稿の原稿・ドラフト・最終稿を_codexに集約し、管理場所・命名規則・運用フロー・NocoDB同期の最小ルールを統一するためのSkill。コンテンツのSSOTを決めたい、管理場所を整備したい、noteとX Articleの共通運用を作りたいときに使用する。
---

# brainbase-content-ssot

## 基本原則（SSOT）
- **コンテンツの正本は_codex**。NocoDBは「状態/配信/計測」の運用DBとして扱う。
- **noteとX Articleは同一本文**。原稿は1セットだけ管理する。
- **draft量ではなく出荷量**をKPIに置き、公開完了がゴール。

## 管理場所（正本パス）
- **SSOTルート**: `/Users/ksato/workspace/shared/_codex`
- **SNS/記事管理**: `_codex/sns/`

### note / X Article（長文）
- すべて `_codex/sns/drafts/` に保存
- 命名規則: `{topic}_structure.md`, `{topic}_draft.md`, `{topic}_reviewed.md`, `{topic}_final.md`
- `topic` は `snake_case` を使う（例: `ai_human_skills`）
- X Articleは **noteと同じ本文**。`_final.md` を正として使い回す

### X短文（量産バッチ）
- `_codex/sns/drafts/batch_YYYY-MM-DD/all_drafts.md`
- 画像が必要なら: `batch_YYYY-MM-DD/images/`

### 戦略・ガードレール
- `sns_strategy_os.md` / `style_guide.md` / `rules.md` / `x_account_profile.md`
- `note_strategy.md`

## 運用フロー（最短）
1. **Pillar決定**（議事録・活動ログから抽出）
2. **note-smartで長文を作成** → `{topic}_final.md` まで作る
3. **X Articleは同じ本文で出稿**（noteと同日or翌日）
4. **sns-smartでX短文を30本/日バッチ生成**
5. **NocoDBにContentレコード作成/更新**（状態管理）

## NocoDBの最小同期ルール
- Contentレコードは **1レコード=1チャンネル=1出荷物**
- `primary_channel` を正として運用（`channel`は使わない）
- `status` は **編集パイプライン専用**: `draft → review → scheduled → published → archived`
- note/X Articleは **同じsource** を参照（`{topic}_final.md`）

## 迷ったら
- 長文は **note-smart**
- 短文は **sns-smart**
- SSOTは **_codex**、運用は **NocoDB** で分離する
