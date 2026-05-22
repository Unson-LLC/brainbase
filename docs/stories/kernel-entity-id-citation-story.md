---
story_id: kernel-entity-id-citation
title: 人物・組織・顧客・案件を含む応答で Graph entity ID 併記を必須化 (kernel 規範)
source:
  type: maintenance
  origin: conversation
  url: N/A
  date: 2026-05-22
architecture_docs:
  - path: N/A (ADR)
    status: not_required
    reason: 既存 CLAUDE.md/AGENTS.md §3 に1項目を追加するだけで、kernel の枠組みや責務分担は変えない
related_tasks: []
status: in_progress
---

# 人物・組織・顧客・案件を含む応答で Graph entity ID 併記を必須化 (kernel 規範)

## 背景

2026-05-22 の Graph SSOT 利用監査 (`_inbox/graph-ssot-monitor/2026-05-22.md`):

- graph 自発引き率 10.1% (前日 10.3% 横ばい) — PR #812 で UserPromptSubmit hook を条件付き強リマインドに変えたが、明確な改善には至らず
- 主な miss: salestailor STR-049 「対象顧客確認」(644 calls, graph 0) / VibePro reviewer 35件並列 (graph 0)
- VibePro reviewer 系は UserPromptSubmit hook を経由しない subprocess (別途 PR が要る)

原因分析 (5層モデル) で、Hook 拡張 (層1) と SKILL.md 構造化 (層3) は対処済。**層4 (workflow tunneling) と層5 (cost-benefit 計算)** が残課題。

本 Story は**出力規範を変える**ことで、agent の意思決定路を逆方向から押す。

## 方針

CLAUDE.md / AGENTS.md §3 Brainbase Non-Negotiables に **「人物・組織・顧客・案件を回答に含めるなら、Graph entity ID (`per_xxx` / `org_xxx` / `cus_xxx` / `prj_xxx` 等) を併記する」** を追加する。

この規範の効用:

1. **正当な entity ID を出すには Graph を引かざるを得ない** — 強制力が出力側から逆方向に働く
2. **Graph に無い entity も明示できる** — 「Graph に未登録」と書けば嘘にはならない (escape valve あり)
3. **session compaction でも Behavioral Kernel は早期再ロードされやすい** — Hook が届かない subprocess (VibePro reviewer 等) にも効く可能性

## 受け入れ基準

### ドキュメント

- [ ] CLAUDE.md §3 Brainbase Non-Negotiables の「Graph SSOT first」直後に新規ブレットを追加:
  - `**Entity ID citation**: When replying with people / organizations / customers / projects, cite the Graph entity ID (per_xxx / org_xxx / cus_xxx / prj_xxx) you verified. If the entity is not in the Graph, say so explicitly rather than silently omitting the citation.`
- [ ] AGENTS.md にも同じブレットを同位置に追加 (VIBEPRO_CODEX_START マーカー以前の §3 内)
- [ ] CLAUDE.md / AGENTS.md とも 200 行未満を維持
- [ ] AGENTS.md の VIBEPRO_CODEX_START..END ブロックは触らない (意図的 divergence)
- [ ] §3 共通部分 (line 1-103 範囲) が `diff <(head -103 AGENTS.md) CLAUDE.md` で同一であること

### Story

- [ ] 本 Story 文書

## 非対象 (scope out)

- VibePro reviewer agent prompt 改修 (#1 推奨アクション、別 Story / 別 repo)
- Hook regex 拡張 (#2 推奨アクション、別 Story)
- 個人 KG / KG 関連の規範追加

## 実装タスク

1. clean worktree `fix/kernel-entity-id-citation` (済)
2. Story 本文 (本ファイル)
3. CLAUDE.md §3 にブレット追加
4. AGENTS.md §3 にブレット追加 (VIBEPRO_CODEX_START マーカー以前の位置)
5. `diff <(head -103 AGENTS.md) CLAUDE.md` で同期確認
6. `wc -l CLAUDE.md AGENTS.md` で行数確認 (200 未満維持)
7. commit + vibepro pr prepare + PR

## 検証

```bash
wc -l CLAUDE.md AGENTS.md
# CLAUDE.md: 104 (+1), AGENTS.md: 148 (+1) を期待

diff <(head -103 AGENTS.md) CLAUDE.md
# 差分ゼロを期待 (§3 共通部分)

grep -n "Entity ID citation" CLAUDE.md AGENTS.md
# 両方で hit を期待
```

## レビュー観点

- 規範が agent に対して action-bound (「引け」「書け」) になっているか、ふんわり「考慮せよ」止まりでないか
- escape valve (「Graph に無い」と明示できる) があり、嘘にならないか
- 規範文が `per_xxx` / `org_xxx` 等の具体 ID prefix を含み、agent が「何を出せばよいか」直ちに分かるか
- §3 の他の Non-Negotiables と整合 (重複・矛盾なし)

## 関連

- 監査レポート: `_inbox/graph-ssot-monitor/2026-05-22.md`, `2026-05-21.md`
- 前段 PR #798: graph.brain-base.work → bb.unson.jp 統一 (MCP 配管)
- 前段 PR #812: graph-ssot-reminder / capability-map-reminder を条件付き強リマインドに変更
- 同セッションの分析: 「なぜこんなに引けてないの」5層原因分解と改善アクション提示
