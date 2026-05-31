---
story_id: sessionstart-memory-preamble
title: 毎プロンプト reminder を廃し、SessionStart で3層メモリ (個人KG/Graph/Capability) を1回注入する
source:
  type: maintenance
  origin: conversation
  url: N/A
  date: 2026-05-31
architecture_docs:
  - path: N/A (ADR)
    status: not_required
    reason: 既存メモリ層 (personal KG / Graph SSOT / capability map) の配送機構を reminder→injection に置換するだけ。新規データモデルは作らない
related_stories:
  - simplify-ssot-self-assessment-hook
  - capability-personal-kg
  - graph-ssot-trigger-improvements
status: in_progress
---

# 毎プロンプト reminder を廃し、SessionStart で3層メモリを1回注入する

## 背景

2026-05-21〜30 の10日間 Graph SSOT 利用監査で確定したこと:
- 毎プロンプト systemMessage を撃つ reminder 系 hook (graph-ssot-reminder / capability-map-reminder / kernel Entity ID 規範 / personal-kg.yml 登録) はいずれも自発引き率を上げなかった (graph 0.8〜10%、capmap real ほぼ 0%、Entity ID 出現ゼロ)
- 唯一機能したのは「ユーザが直接叱った」1回と、SKILL.md の「Read the yml before reasoning」強制文言
- 配送調査で判明: hook は claude-main にしか届かず subagent/codex (母集団の9割) には届いていなかった

参照プロジェクト AgentMemory (github.com/rohitg00/agentmemory) の設計が答えを示していた:
**reminder しない。SessionStart で関連 context を content として自動注入する。** PostToolUse 捕捉 + SessionStart 注入 + Claude/Codex 両 hook 配線。

Brainbase は捕捉側 (oyasumi が議事録 + codex/claude 会話ログから個人KGを日次蓄積) を既に持つ。欠けているのは「蓄積したメモリを毎セッション冒頭で agent に食わせる経路」だけ。

## 方針: 注入は content の形に合わせて変える

注入が効く条件は (A) content が小さい (B) 冒頭で関連性が分かる。3層で当て方が違う:

| 層 | サイズ | 冒頭で関連分かる | 配送 |
|---|---|---|---|
| 個人KG (判断OS) | 小・安定 | 常に要る | **全 profile を注入** |
| Graph SSOT | 大 (person54/org19/customer9/decision124) | タスク次第 | **カタログ (名前リスト+引き方) のみ注入** → 深掘りは MCP |
| Capability Map | 中 (17 yml) | 障害時のみ | **menu (capability_id 一覧+開け) のみ** → 詳細は yml Read |

注入は "awareness"、pull (MCP search / yml Read) は "detail" の2層構造。AgentMemory の「SessionStart project profile + on-demand hybrid search」と同型。

## やること: 足す + 引く

### 引く (毎プロンプト reminder の整理)
- `ssot-self-assessment.ts` を UserPromptSubmit から外す → SessionStart preamble に統合
- `skill-reminder.ts` 削除 (harness が skill 一覧を既に提示)
- `merge-api-reminder.ts` 削除 → preamble に1行 guardrail として残す
- `autonomy-reminder.ts` 削除 (orphan、未登録ファイル)
- 残す (機能系): test-enforcer / activity-bridge / context-loader-wrapper / env-section-injector-wrapper

### 足す (SessionStart preamble)
- `scripts/generate-memory-preamble.mjs`: 3層を1ファイルに materialize
  - 個人KG profile: memory_candidates (owner-visible, personal_kg_core) top + 直近delta
  - Graph SSOT カタログ: bb.unson.jp /api/info/graph/entities の person/org/customer 名前リスト
  - Capability menu: docs/brainbase-capabilities/capabilities/*.yml の id 一覧 (静的)
  - 出力: `~/.brainbase/memory-preamble.txt` (≤2000 token)
- `.claude/scripts/hooks/session-start/inject-memory-preamble.ts`: 上記 file を読んで注入するだけ (DB/tunnel を hot path に持ち込まない)。stale (>2日) なら1行警告
- settings.json SessionStart に登録

## 受け入れ基準

- [ ] UserPromptSubmit から ssot-self-assessment / merge-api-reminder / skill-reminder が外れる
- [ ] autonomy-reminder.ts ファイル削除
- [ ] UserPromptSubmit に残るのは機能系4つ (test-enforcer/activity-bridge/context-loader/env-injector) のみ
- [ ] `generate-memory-preamble.mjs` が3層を含む `~/.brainbase/memory-preamble.txt` を生成 (≤2000 token)
- [ ] `inject-memory-preamble.ts` が file を読んで systemMessage 注入 (file 無い時は空、stale 時は警告付き)
- [ ] settings.json SessionStart に inject-memory-preamble 登録 (既存 session-start-copy-plugins.sh は残す)
- [ ] hook smoke: preamble file ありで非空注入、無しで空・continue:true
- [ ] CLAUDE.md/AGENTS.md 200行未満・§1-103 同期維持

## 非対象 (follow-up)
- oyasumi daily への generator 組み込み (まず standalone script、cron 化は別 PR)
- `~/.codex/hooks.json` session_start への移植 (codex 配送、別 PR)
- audit script の preamble 利用率計測 (別 PR)
- subagent への注入 (SessionStart の範囲外)

## 検証 / 期待効果
- 毎prompt 3 reminder noise → SessionStart 1回の content 注入
- Graph カタログで「固有名詞=登録エンティティ」の認知トリガーを与え、引き率向上を狙う
- 効果は新セッション主体になる数日後の audit で測定 (preamble 利用率)
