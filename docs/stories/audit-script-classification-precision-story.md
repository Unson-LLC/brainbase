---
story_id: audit-script-classification-precision
title: Graph/Capmap/KG 日次監査スクリプトを永続化し、誤判定除外で hit 率の真値を測れるようにする
source:
  type: maintenance
  origin: conversation
  url: N/A
  date: 2026-05-23
architecture_docs:
  - path: N/A (ADR)
    status: not_required
    reason: 既存監査運用 (cron + agent + Python script) の精度向上のみで、新規アーキ判断ではない
related_stories: []
status: in_progress
---

# Graph/Capmap/KG 日次監査スクリプトを永続化し、誤判定除外で hit 率の真値を測れるようにする

## 背景

2026-05-23 監査 (`_inbox/graph-ssot-monitor/2026-05-23.md`) で 3 日連続 graph 自発引き率が **10.3% → 10.1% → 10.0%** で頭打ち。介入 (PR #812 Hook 強化 / PR #818 kernel entity ID / PR #819 personal-kg yaml) の効果評価が出来ない。

原因は監査スクリプトの **topic 分類が雑** で、本来 graph/capmap が不要なセッションが多数誤って候補にカウントされ、分母が膨張していること:

- **VibePro reviewer subagent** (`VibePro review task.` / `You are performing ... VibePro ... parallel review`): 30+ session/day。コード差分レビューが目的で、graph entity 検索は本筋ではない。
- **監査タスク自身**: `Graph SSOT / Capability Map / 個人KG 利用状況を...` という meta prompt が 3 件/day で graph/capmap/kg 全部に hit してしまう。
- **salestailor STR-049 letter feature reviewer**: 同様の reviewer pattern。

これらを除外せず母集団に入れると hit 率が常に低く出る (分子は変わらず分母だけ膨張)。介入効果を見るには **「真に graph/capmap が必要なセッション」だけで分母を作る** 必要がある。

加えて、現在スクリプトは agent が毎日 `/tmp/audit_graph_ssot_v2.py` を再生成しており **TDD 不可能 / 累積改善不可** な状態。

## 方針

1. 監査スクリプトを **`.claude/scripts/audit/` 配下** に永続化する (cron prompt は script 呼び出しのみに簡略化)。
2. **topic 分類ロジックを純関数として `classify.ts` に分離**、TDD で誤判定パターンを fixture 化して回帰防止。
3. **既知の false positive 除外パターン** を組み込む:
   - VibePro reviewer subagent prompt (regex)
   - 監査タスク自身 (regex)
   - 将来的に追加された pattern も fixture 1件追加で済む構造
4. cron prompt を更新: script 実行 → JSON 出力 → agent は Phase 2 (価値判定) と report 生成のみ担当。

## 受け入れ基準

### コード

- [ ] `.claude/scripts/audit/classify.ts` 新規:
  - export `classifyTopic(prompt: string): { graph: boolean; capmap: boolean; kg: boolean; excluded: string | null }`
  - 既存 `graph-ssot-reminder.ts` / `capability-map-reminder.ts` と整合する regex を流用 (重複定義は避け、constants を共有)
  - 除外パターン: VibePro reviewer / 監査タスク自身 / その他
  - excluded が non-null なら topic 分類は全 false
- [ ] `.claude/scripts/audit/graph-ssot-audit.ts` 新規 (main entry):
  - 引数: `--date YYYY-MM-DD`, `--out /path/to/output.json`
  - Claude Code / Codex jsonl を直近24h で stream parse
  - classify を適用して JSON 出力
  - 出力形式は既存 `/tmp/graph_ssot_audit_*.json` を踏襲 (results 配列 + by_worktree 集計)
- [ ] `.claude/scripts/test/test-classify.ts` 新規:
  - 真陽性 fixture (10件): 実際の prompt で graph/capmap/kg のいずれかを期待
  - 真陰性 fixture (5件): 純技術 prompt で全 false を期待
  - 除外 fixture (5件): VibePro reviewer / 監査タスク等で excluded non-null を期待
  - すべて pass

### cron

- [ ] cron job `56708992` を一旦 delete → 新規 cron 作成
- [ ] 新 cron prompt は **script 実行 + 結果 JSON を agent に渡して Phase 2 + report 生成** の構造
- [ ] cron prompt 中に「script は `.claude/scripts/audit/graph-ssot-audit.ts` 利用、毎日勝手に再実装しない」を明示

### ドキュメント

- [ ] 本 Story 文書
- [ ] (任意) `_inbox/graph-ssot-monitor/README.md` で運用説明 — 後回し可

## 非対象 (scope out)

- 既存の常時注入 Hook (graph-ssot-reminder / capability-map-reminder) の更なる強化 — 本 Story はあくまで **計測精度**
- 全 jsonl 過去 fully 再走査 — 直近24h のみ
- Phase 2 の価値判定 (valuable/wasted/...) を script 化 — LLM judgment が必要なので agent 側に残す

## 検証

```bash
# テスト
npx tsx .claude/scripts/test/test-classify.ts

# 単発実行 (本日)
npx tsx .claude/scripts/audit/graph-ssot-audit.ts --date $(date +%F) --out /tmp/audit-test.json
jq '.by_worktree' /tmp/audit-test.json
jq '.results | map(select(.excluded)) | length' /tmp/audit-test.json
# → 除外件数が non-zero (VibePro reviewer / 監査タスクが除外されているはず)

jq '.results | map(select(.topic_tags | length > 0 and (.excluded | not))) | length' /tmp/audit-test.json
# → 真の「topic 候補」件数 (前日 110 → 大幅減少を期待)
```

## 期待効果

- 分母から VibePro reviewer ~30件 / day と監査タスク自身 3件 を除外 → 真の hit 率を測れる
- 介入効果 (PR #812 / #818 / #819) が今後どう効くかを定量評価可能に
- スクリプトが TDD 可能 → 将来の追加 false positive を fixture 追加で 1分対応

## 関連

- 監査レポート: `_inbox/graph-ssot-monitor/2026-05-23.md` (3日連続観測)
- 前段 PR #812 (Hook 条件付き化) / PR #818 (kernel entity ID) / PR #819 (personal-kg yaml)
- 過去 ad hoc script: `/tmp/audit_graph_ssot_v2.py`, `/tmp/codex_session_audit.py`, `/tmp/audit_sessions.py`
- 直近 audit JSON サンプル: `/tmp/graph_ssot_audit_2026_05_23.json` (163 sessions, 110 graph候補, 11 hit)
