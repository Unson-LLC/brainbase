---
story_id: graph-ssot-trigger-improvements
title: Graph SSOT / Capability Map 引きを「常時 wallpaper」から「パターン条件付き強リマインド」に変える
source:
  type: maintenance
  origin: conversation
  url: N/A
  date: 2026-05-21
architecture_docs:
  - path: N/A (ADR)
    status: not_required
    reason: 既存 hook の挙動を「常時注入」から「条件付き注入」へリファクタするだけで、Hook 契約自体は変更しない
related_tasks: []
status: in_progress
---

# Graph SSOT / Capability Map 引きを「常時 wallpaper」から「パターン条件付き強リマインド」に変える

## 背景

2026-05-21 の Graph SSOT 利用監査 (`_inbox/graph-ssot-monitor/2026-05-21.md`) で以下が判明:

- 直近24時間 119 session のうち、Graph 自発的な引きは **3件のみ** (NocoDB タスク委譲経由)
- Capability Map 引きは **0 件 (real_load)**。30 件は SKILL.md を `sed` するだけの儀式で yaml 本体未到達
- 個人 KG 引きは `/oyasumi` コマンド経路のみ (`/oyasumi` 起動時の guard 内自動 curl)

原因分解の結果、層1 (トリガー欠落) と層3 (Capability Map の構造的欠陥) が支配的:

1. **常時注入 hook が wallpaper 化**: 既存 `graph-ssot-reminder.ts` と `capability-map-reminder.ts` は毎プロンプトに同じ system message を吐く。agent はこの pattern を「無視していい noise」と学習し、tool 呼び出しに繋がらない。
2. **SKILL.md が pointer に過ぎない**: `brainbase-capability-map/SKILL.md` は 41 行で、本体 yaml (`docs/brainbase-capabilities/capabilities/*.yml`, 16 ファイル) への参照のみ。agent が SKILL.md を `cat` しても具体的な capability が何かは判らないので、`Read` を追加で呼ばずに済ませてしまう。

## 方針

**Hook の意味論を「常時 reminder」から「該当時のみ強指示」に切り替える**。プロンプトに対応するキーワードを検出した時だけ、agent が無視できない強い指示を注入する。

**SKILL.md に capability ID の inline 一覧表を追加**して、agent が SKILL.md だけで「次に何を Read すべきか」を判断できるようにする。

## 受け入れ基準

### コード

- [ ] `graph-ssot-reminder.ts` が `CLAUDE_USER_PROMPT` を読み、人物名 (漢字2-4字+「さん/氏」) / 顧客名 (固定リスト) / 「誰の/どの顧客の/決裁/案件/契約」キーワードのいずれかを検出した時だけ強リマインドを返す。検出しない時は空文字を返し、agent context を汚さない
- [ ] `capability-map-reminder.ts` が同様に「動かない/見えない/壊れた/session作成/auth/31013/xterm/terminal/launchd」等のキーワード検出時のみ強リマインドを返す
- [ ] 強リマインドは「上記キーワードを検出した。<具体的tool/yaml path> を呼んでから返答せよ。記憶推測ベースの返答は規約違反」の構造で、ふんわりした reminder ではなく action-bound にする
- [ ] `brainbase-capability-map/SKILL.md` に 16 capability の inline 表 (id / trigger keywords / yaml 相対パス) を追加
- [ ] SKILL.md 末尾に「該当 capability に reasoning する時は対応 yaml を Read してから判定」の REQUIRED 節を追加

### テスト

- [ ] `.claude/scripts/test/test-graph-ssot-reminder.ts` 新規。陽性パターン (人名/顧客名/案件) 5件で system message が非空、陰性パターン (純技術プロンプト) 5件で空、を assert
- [ ] `.claude/scripts/test/test-capability-map-reminder.ts` 新規。同様に陽性/陰性 5件ずつ
- [ ] 既存 hook テスト (test-pre-tool-use-hooks.ts 等) は壊さない

### ドキュメント

- [ ] 本 Story 文書
- [ ] hook 内部 (header) に「常時注入から conditional に変更した理由」の comment を1行

## 非対象 (scope out)

- VibePro reviewer agent prompt 改修 — VibePro CLI は別 repo にあり、本 PR では触らない。別 Story で扱う
- 個人 KG 関連 hook 改修 — `/oyasumi` 経路で既に動いているため後回し

## 実装タスク

1. clean worktree `fix/graph-ssot-trigger-improvements` (済)
2. Story 本文 (本ファイル)
3. TDD: `test-graph-ssot-reminder.ts` + `test-capability-map-reminder.ts` 新規 (Red)
4. `graph-ssot-reminder.ts` を conditional に書き換え (Green)
5. `capability-map-reminder.ts` を conditional に書き換え (Green)
6. `brainbase-capability-map/SKILL.md` に inline 表追加
7. typecheck + 既存テスト regression 確認
8. commit + vibepro pr prepare + PR

## 検証

```bash
npx tsx .claude/scripts/test/test-graph-ssot-reminder.ts
npx tsx .claude/scripts/test/test-capability-map-reminder.ts
npx tsx .claude/scripts/test/test-pre-tool-use-hooks.ts
npx tsx .claude/scripts/test/test-post-tool-use-hooks.ts
npm run typecheck
```

手動 smoke (worktree内):
```bash
CLAUDE_USER_PROMPT="安部潔仁さんとのMTG準備して" .claude/scripts/run-hook.sh .claude/scripts/hooks/user-prompt-submit/graph-ssot-reminder.ts
# → systemMessage 非空 (Graph 引け指示)

CLAUDE_USER_PROMPT="このxtermの描画バグ直して" .claude/scripts/run-hook.sh .claude/scripts/hooks/user-prompt-submit/capability-map-reminder.ts
# → systemMessage 非空 (terminal.transport.yml 読め指示)

CLAUDE_USER_PROMPT="このreact componentをリファクタして" .claude/scripts/run-hook.sh .claude/scripts/hooks/user-prompt-submit/graph-ssot-reminder.ts
# → systemMessage 空文字
```

## レビュー観点

- 検出 regex が過剰でない (純粋技術プロンプトで誤発火しない)
- 検出 regex が過小でない (人物名は漢字 + 「さん」だけでなく英字名・カタカナも含む)
- SKILL.md inline 表が古くなった時に detect できる仕組み (yaml ファイル数との突合) があると良い (将来課題)
- 既存の常時注入を完全削除すると新規 agent が「Graph があること」自体を知らずに済むリスク — 妥当な session-once 最小 hint も併用検討

## 関連

- 監査レポート: `_inbox/graph-ssot-monitor/2026-05-21.md`
- 過去 PR #798: graph.brain-base.work → bb.unson.jp 統一 (本 Story の前段、MCP 配管修復)
- 過去 Decision: `decisions/Graphで固有名詞が見つからない場合は、Graph不在と判断せず議事録・transcriptを補助検索する` — 本 Story で hook が強リマインドする内容と整合
