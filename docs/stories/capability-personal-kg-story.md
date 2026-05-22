---
story_id: capability-personal-kg
title: 個人KG (personal-kg) capability を入口 pointer として capability map に追加
source:
  type: maintenance
  origin: conversation
  url: N/A
  date: 2026-05-22
architecture_docs:
  - path: N/A (ADR)
    status: not_required
    reason: 既存 personal-kg 設計 (ADR-007 / SPEC-personal-kg-* / Story 3本) を集約・参照する入口 yaml を追加するだけで、新規アーキテクチャ判断ではない
related_stories:
  - oyasumi-meeting-personal-kg
  - oyasumi-personal-kg-agent-fanout
  - personal-kg-sns-seed-mvp
status: in_progress
---

# 個人KG (personal-kg) capability を入口 pointer として capability map に追加

## 背景

2026-05-22 の Graph SSOT 利用監査で「KG 引きが `/oyasumi` 起動時の guard 内自動 curl にしか発生していない」現状を観測。原因の1つは、**personal-kg が `docs/brainbase-capabilities/` の capability map に未登録**で、agent が「何を / どこで / どう引くか」の判断軸を持てないこと:

- `docs/brainbase-capabilities/capabilities/*.yml` 16ファイルに `personal-kg` / `oyasumi` / `KG` の記述ゼロ
- `brainbase-capability-map/SKILL.md` の inline 表 (PR #812 で追加) も 16行で personal-kg 行なし
- 設計 Story は3本ある (`oyasumi-meeting-personal-kg` / `oyasumi-personal-kg-agent-fanout` / `personal-kg-sns-seed-mvp`) が、capability map から見つけられない

実装はまだ進行中 (multiple stories active) なので、**完全な仕様確定を待たず、入口 pointer として minimum yaml** を入れる。これで agent が KG-related な相談を受けた時に「`personal-kg` capability があり、本体は Story と oyasumi command にある」と認識できる。

## 方針

`docs/brainbase-capabilities/capabilities/personal-kg.yml` を新規追加 (minimum schema)。同時に `brainbase-capability-map/SKILL.md` inline 表に1行追加 (16 → 17 capability)。

yaml の内容は **pointer + 大枠** に絞り、流動性の高い実装詳細 (specific schema / endpoint) は story 側を参照する形にする。

## 受け入れ基準

### yaml

- [ ] `docs/brainbase-capabilities/capabilities/personal-kg.yml` 新規作成
- [ ] 必須 schema: `id`, `name`, `purpose`, `surfaces` (ui/api/code/data), `depends_on`, `verification`, `common_failures`, `runbooks`
- [ ] `surfaces.code` に `.claude/commands/oyasumi.md`, `scripts/oyasumi-meeting-personal-kg.js`, `server/services/sns/oyasumi-meeting-personal-kg-service.js`, `server/services/sns/sns-generation-context-service.js` を列挙
- [ ] `surfaces.data` に `brainbase_ssot.memory_candidates`, `brainbase_ssot.personal_kg_entity_links` を列挙
- [ ] `runbooks` / `troubleshooting` は story と oyasumi command への pointer (新規 runbook 文書は作らない、scope 拡大回避)
- [ ] `purpose` に「personal-kg core (owner-visible candidate store) と SNS projection (sns_ready) の2層構造」を含める

### SKILL.md

- [ ] `.claude/skills/brainbase-capability-map/SKILL.md` の inline 表に 1行追加 (`personal-kg` / `personal-kg.yml` / `/oyasumi 起動・SNS生成・議事録抽出・思想や判断基準の保存`)
- [ ] 表の行数: 16 → 17

### Story

- [ ] 本 Story 文書

### 検証

- [ ] capability yaml ファイル数: 16 → 17
- [ ] SKILL.md `^| \`` で始まる行数 (inline 表): 16 → 17
- [ ] `grep -l personal-kg docs/brainbase-capabilities/` で yaml が引ける

## 非対象 (scope out)

- personal-kg の専用 runbook / troubleshooting 文書作成 — 流動的なので、まずは入口 yaml だけ。需要が見えたら別 Story で追加
- yaml の verification commands 細部 — story 進行中なので minimum (基本 dry-run / write コマンドのみ列挙)
- VibePro reviewer agent prompt 改修 (#1 推奨アクション、別 Story / 別 repo)
- Hook regex 拡張 (#2 推奨アクション、別 Story)

## 実装タスク

1. clean worktree (済)
2. Story 本文 (本ファイル)
3. `personal-kg.yml` 新規作成
4. `brainbase-capability-map/SKILL.md` inline 表に 1行追加
5. ファイル数・行数検証
6. commit + vibepro pr prepare + PR

## 期待効果

- agent が KG-related 相談 (oyasumi/個人KG/SNS生成context/判断基準保存等) を受けた時、capability map 経由で yaml に到達できる
- 「`personal-kg` を使えば良い」と agent が認識すれば、自発的な引きや関連 story 参照が増える
- 監査の `kg候補` 検出率改善・`should_have_queried` 削減

## 関連

- 監査レポート: `_inbox/graph-ssot-monitor/2026-05-22.md`, `2026-05-21.md`
- 前段 PR: #798 (graph URL) / #812 (Hook 条件付き化) / #818 (kernel entity ID 規範)
- Story: `oyasumi-meeting-personal-kg-story.md`, `oyasumi-personal-kg-agent-fanout-story.md`, `personal-kg-sns-seed-mvp-story.md`
- ADR: ADR-007 (personal graph), ADR-011 (sns-posting-ledger-boundary)
- `/oyasumi` command: `.claude/commands/oyasumi.md`
