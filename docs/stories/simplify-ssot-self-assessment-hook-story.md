---
story_id: simplify-ssot-self-assessment-hook
title: 効かない複数介入を全削除し、meta-cognitive な単一 self-assessment hook に置き換える
source:
  type: maintenance
  origin: conversation
  url: N/A
  date: 2026-05-28
architecture_docs:
  - path: N/A (ADR)
    status: not_required
    reason: 既存介入を削除して 1 つの hook に集約するだけ。アーキテクチャ判断ではない
related_stories:
  - graph-ssot-trigger-improvements
  - kernel-entity-id-citation
  - capability-personal-kg
status: in_progress
---

# 効かない複数介入を全削除し、meta-cognitive な単一 self-assessment hook に置き換える

## 背景

2026-05-21 〜 2026-05-28 (7日) の Graph SSOT / Capability Map / 個人KG 利用監査で、3つの介入はいずれも **行動変容ゼロ** だった:

| PR | 介入 | 7日後の効果 |
|---|---|---|
| #812 | conditional reminder hook (graph + capmap) | graph 自発引き率 10.3% → 1.5%、Entity ID 出現 7日連続ゼロ |
| #818 | CLAUDE.md / AGENTS.md kernel §3 「Entity ID citation」規範 | Entity ID 出現 7日連続ゼロ (kernel 単体は無効) |
| #819 | personal-kg.yml を capability map に追加 | yaml 自発到達 7日連続ゼロ |

唯一成功した baao 稽古ライブ session (2026-05-28) を deep dive した結果、**発火条件はユーザの直接叱責 1 回のみ**:

> 「個人KGだぞ？ケイパビリティマップから使い方をちゃんと確認しろよ」

Hook reminder は冒頭で fire してなかった (`graph-ssot-reminder.ts` は実は settings.json 未登録の deadweight)。Skill tool は 119 calls 中 0 回起動。**agent は user の叱責後だけ手動 `find` → `Read SKILL.md` → `Read yml` を実行**した。

## 構造的問題

**複数の弱信号 (hook 2種 + kernel 規範 + skill description + yaml) を敷くほど agent は wallpaper として無視する**。「キーワード regex で条件発火」も結局は agent が prompt 中の特定語を見ることに依存するが、agent 自身は自分の応答内容を見て判断する方が確度が高い。

## 方針

**引き算 + meta-cognitive 集約**:

1. **削除** (7日 0% 効果が確定):
   - `.claude/scripts/hooks/user-prompt-submit/graph-ssot-reminder.ts` (deadweight、settings 未登録)
   - `.claude/scripts/hooks/user-prompt-submit/capability-map-reminder.ts` (active だが効果ゼロ)
   - 関連テスト: `test-graph-ssot-reminder.ts`, `test-capability-map-reminder.ts`
   - `.claude/settings.json` の hook 登録 entry
   - `CLAUDE.md` / `AGENTS.md` §3 の「Entity ID citation」bullet

2. **残す** (動いている):
   - `brainbase-capability-map/SKILL.md` の「Read the yml before reasoning. SKILL.md alone is not enough」強制文言
   - `personal-kg.yml` 等 capability yaml 本体
   - audit script v6

3. **新規追加** (唯一の hook):
   - `.claude/scripts/hooks/user-prompt-submit/ssot-self-assessment.ts`
   - 常時注入だが**短く action-bound な meta-cognitive 自己審査**
   - キーワード regex に依存せず、agent が自分の応答内容で判定
   - 内容案 (≦5行):
     ```
     [SSOT self-check] 返答前に自問せよ:
     1. 返答に人物/組織/顧客/案件/decision を含む? → mcp__brainbase__ で entity 引き
     2. 返答に Brainbase 機能/不調/UI 動作を含む? → skill brainbase-capability-map → 該当 yml を Read
     3. 返答に佐藤さん固有の判断軸/履歴/思想を含む? → 個人KG (memory_candidates / /oyasumi 経路) を確認
     いずれか該当時に未引きで推測した場合、最低限「(未登録)」と明示。silent omission は規約違反。
     ```

## 受け入れ基準

### 削除

- [ ] `graph-ssot-reminder.ts` と `capability-map-reminder.ts` を削除
- [ ] 関連 test 2件削除
- [ ] `.claude/settings.json` から `capability-map-reminder` entry 削除 (graph-ssot は元から未登録)
- [ ] `CLAUDE.md` §3 から「Entity ID citation」bullet 削除
- [ ] `AGENTS.md` §3 から同 bullet 削除
- [ ] §3 共通部分が CLAUDE.md と AGENTS.md head -103 で diff ゼロ

### 追加

- [ ] `.claude/scripts/hooks/user-prompt-submit/ssot-self-assessment.ts` 新規
  - 常時注入 (キーワード判定無し)
  - 3 self-ask question + 1 escape clause で 5 行以内
  - action-bound: 各 question に「→ どう引くか」が併記される
- [ ] `.claude/settings.json` に新 hook を登録 (削除した entry の位置に置換)
- [ ] `.claude/scripts/test/test-ssot-self-assessment.ts` 新規
  - systemMessage が non-empty
  - 3 self-ask 文言が含まれる
  - hook 出力が valid JSON

### Story

- [ ] 本 Story 文書

### 検証

- [ ] `npx tsx --test .claude/scripts/test/test-ssot-self-assessment.ts` pass
- [ ] 手動 smoke: 任意プロンプトで hook が 1回 fire
- [ ] 既存 hook test regression なし (test-pre-tool-use-hooks / test-post-tool-use-hooks)
- [ ] CLAUDE.md / AGENTS.md 200 行未満維持

## 非対象 (scope out)

- audit script v7 (cohort split / observer-self 除外) — 別 Story
- VibePro reviewer agent prompt 改修 — 別 repo
- SKILL.md 強制文言の他 skill への複写 — 別 Story

## 期待効果 (検証可能仮説)

- 4種信号 → 1種に集約で agent の wallpaper 化を緩和
- meta-cognitive 自己審査により regex で拾えない応答パターンも捕捉
- 効果が 7-14日見ても 0% なら、**hook 機構自体が無効** という構造判定が初めて可能になる (次の手は VibePro reviewer prompt 改修しか残らない)

## 関連

- 監査レポート: `_inbox/graph-ssot-monitor/2026-05-28.md`
- baao deep dive 解剖結果 (2026-05-28 セッション内議論)
- 削除対象の PR: #812 (Hook conditional) / #818 (kernel entity ID) / 部分的に #819 (personal-kg yaml は残す)
