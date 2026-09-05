---
story_id: story-brainbase-judgment-audit-fail-closed
title: Codex DesktopでJudgment監査表示を必ず成立させる
source_requirement:
  source: Codex conversation 2026-08-11
  approved_at: 2026-08-11
architecture_docs:
  - path: docs/architecture/story-brainbase-judgment-audit-fail-closed.md
    status: accepted
spec_docs:
  - docs/specs/story-brainbase-judgment-audit-fail-closed.md
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "Hook activationの検証とStopのfail-closed契約は、owner-visible監査を無音で欠落させないための一つの運用境界である。"
status: active
created_at: 2026-08-11
updated_at: 2026-08-11
---

# Codex DesktopでJudgment監査表示を必ず成立させる

## Story

Brainbaseを運用監査するownerとして、各Codex turnがJudgment Resolverへ入ったかを最終回答の先頭で短く確認したい。Hook設定を配布しただけ、またはテスト用entrypointが成功しただけで「有効」と扱わず、実際のDesktop Hostがその設定を読み、episodeを開始し、保存済み監査行を表示した時だけ復旧済みと判断したい。

## 背景

global `UserPromptSubmit`、`PostToolUse`、`PostToolUseFailure`、`Stop`は設定ファイルに存在し、個別entrypointのテストも成功していた。しかし設定変更前から動き続けていたCodex Desktop Hostでは、2 turn連続でepisodeが作られず、`🧠 判断参照:`行がない回答が通常どおり完了した。

Codex自身の`hooks/list`で確認すると、4つのResolver Hookは登録・有効だったが、すべて`trustStatus: modified`だった。保存済みtrust recordの存在を現在のHook identityへの信頼と取り違えたため、未稼働を復旧済みと報告していた。

またHost adapterは、当初、監査不足のactive再Stopを非zeroで終了していた。Codex DesktopはHookの非zero終了をblockではなく失敗通知として扱うため、最初の修復要求には`decision:block`が必要である。一方、active再Stopでも同じblockを無制限に返すと再生成が終わらないため、修復機会を1回に限定して明示終了する。さらに、参照必須でない0-call turnには`🧠`行しかなく、意図した未参照と監査欠落をownerが区別できなかった。

## 受け入れ基準

- [ ] readiness checkはCodex公式`hooks/list`を使い、global `UserPromptSubmit`、`PostToolUse`、`PostToolUseFailure`、`Stop`が同じcanonical entrypointを指すこと、各Hookがenabledであること、両方のtool Hook matcherが正しいこと、現在のidentityが`trusted`または`managed`であることを検証する。
- [ ] `modified`、`untrusted`、missing、Codex status取得失敗は`trust_required`または診断エラーとして非zeroで終了する。Brainbaseはtrust hashを計算・書換しない。
- [ ] readiness check成功は`ready_for_fresh_task`までとし`active`とは呼ばない。Hookのtrust承認後に作成した新規taskのepisode、final receipt、実transcriptのowner監査prefixがそろった場合だけ`proven_active`とする。
- [ ] episode identityまたは対応episodeがないStopは無音の`{}`を返さず、activation failureとして明示的にfail-closedする。
- [ ] required knowledgeまたはowner監査prefixが欠ける最初の修復可能なStopは`decision:block`を返し、なお不完全なactive再Stopは`judgment_stop_repair_exhausted`で非zero終了してfinal receiptを作らない。
- [ ] owner監査prefixは行末の空白・tabだけを表示上同一として扱い、本文・順序・回数は保存値と一致させる。
- [ ] 参照必須でなく実際のBrainbase callが0件なら、`📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓`を必ず表示する。
- [ ] `task_complete`として扱えるのは、同一turnにcomplete final receiptが1件ある場合だけとする。
- [ ] completeなturnは従来どおりfinal receiptをexactly oneで確定し、保存済み`🧠`、`📚`、`⚠️`行の順序とdigestを検証する。
- [ ] runbook、Capability、Skill、Architecture、Spec、unit/integration/live E2Eが同じactivation/fail-closed契約を説明する。
- [ ] 修正後はcanonical VibePro npm runtimeでtargeted unit/integration、readiness fixtureを記録し、trust承認後の新規Desktop taskによるlive E2EをPRまたはdeploy evidenceへ結び付ける。

## スコープ外

- Codex Desktop本体のhook reload実装を変更すること
- trust hashをBrainbase側で生成・偽装すること
- owner監査行をjournalなしにmodelやpromptだけで生成すること
- Judgment Resolverの分類DAG、Knowledge Resolver、Brainbase API schemaを変更すること
