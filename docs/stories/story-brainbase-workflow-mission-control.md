---
story_id: story-brainbase-workflow-mission-control
title: Brainbase Workflow Mission Control
source_requirement:
  type: user_reported_gap
  description: Brainbase はセッションと個別コマンドを扱えるが、仕事や定期業務を小規模チームで運用として閉じるための workflow / run / owner / context / approval / closure の正本を持っていない。
architecture_docs:
  - path: docs/architecture/brainbase-workflow-mission-control-architecture.md
    status: proposed
spec_docs:
  - path: docs/specs/story-brainbase-workflow-mission-control-spec.md
    status: proposed
related_stories:
  - story-workflow-mission-control-foundation
  - story-workflow-project-context-binding
  - story-workflow-run-ledger-core-runner
  - story-workflow-dashboard-v0
  - story-workflow-human-in-the-loop
  - story-workflow-routine-integration
status: draft
created_at: 2026-06-01
updated_at: 2026-06-01
---

# Brainbase Workflow Mission Control

## 背景

Brainbase は AI セッション、terminal、VibePro、`/ohayo`、`/oyasumi`、`/retro` のような実行入口を持つ。一方で、仕事や定期業務を「個人で始め、後から小規模チームで回せる状態」にするための正本が弱い。

弱いのは実行能力そのものではない。弱いのは、実行後に以下が見えないことである。

- どの workspace / project に属する仕事なのか。
- どの context を使って AI が判断・生成したのか。
- owner / assignee / approver は誰か。
- run が成功したのか、未完了なのか、人間判断待ちなのか。
- 次に誰が何を裁くべきか。
- output / evidence / audit がどこに残ったのか。

## ユーザーストーリー

Brainbase で自分の仕事を workflow 化していく利用者として、workflow の所属 project、利用 context、実行履歴、次アクション、人間判断待ちを一画面で確認したい。そうすることで、個別のコマンドやセッションを「一度動いた」で終わらせず、まず個人運用として回し、後からチーム運用に拡張できる。

## インタビューで固定した前提

2026-06-01 の user interview で、初期MVPの前提を次のように固定した。

- 最初の実 routine は `/ohayo` でよい。`brainbase-alive` は runner / ledger / dashboard の疎通確認として先に置く。
- Workflow が所属する Project は、Session 作成時に選択する既存 Project と同じ概念を使う。Workflow 専用の別 Project 概念は作らない。
- Context は実行前に「使う予定の context」が見え、実行後に「実際に使った context snapshot」が見える必要がある。
- Closure は最初から重くしない。MVPでは `open / closed / needs_action` 程度のシンプルな運用から始める。
- 最初は個人運用、つまり owner / assignee / approver は同一人物でも成立する形で始める。その後、team運用へ自然に拡張できるようにフィールドは分けておく。
- Human-in-the-loop は workflow の外側の例外処理ではなく、workflow definition 上の approval gate または human step として設計する。

## プロダクト方針

Brainbase Workflow Mission Control は cron 管理ではない。中心は runner ではなく、run の状態管理、context 可視化、次アクション、人間判断待ち、audit である。

```text
Workspace
  -> Project
    -> Workflow Definition
      -> Workflow Run
        -> Resolved Context Snapshot
        -> Outputs / Evidence
        -> Action Required
        -> Human Step / Approval
```

既存の Claude/Codex/ChatGPT/cron/local CLI は runner になり得る。しかし Brainbase の価値は runner を増やすことではなく、どの runner が動いても `runWorkflow()` を通して同じ ledger、同じ dashboard、同じ audit に戻すことにある。

## スコープ

- Workflow を workspace と project に所属させる。
- Project は Session 作成で使っている既存 Project catalog / selector の概念に揃える。
- Workflow に owner、execution environment、risk、human-in-the-loop policy、context sources を持たせる。
- Workflow Run をログではなく作業単位として扱う。
- Run 実行時に、予定 context と実際に解決された context snapshot を残す。
- Dashboard は workflow 一覧ではなく、今見るべき action required / human waiting / failed を優先表示する。
- local / cloud / hybrid runner は共通の `runWorkflow()` 入口に接続する。
- `/ohayo`、`/oyasumi`、`/retro` は最終的に Routine subtype として Workflow Run に接続する。

## 受け入れ条件

- [ ] Workflow Mission Control の全体 Story / Architecture / Spec が存在する。
- [ ] Workflow は `workspace_id` と `project_id` を必須にする方針が明記されている。
- [ ] `project_id` は Session 作成時の既存 Project と同じ概念を使う方針が明記されている。
- [ ] Workflow の protected API は、Session selector と同じ Project identity / alias を使うが、空の `projectCodes` を unrestricted として扱わない方針が明記されている。
- [ ] Workflow は `owner_id` を必須にし、最初は個人運用でも成立する方針が明記されている。
- [ ] Workflow は `context_sources` を持ち、UI で何の context を使うか見える方針が明記されている。
- [ ] Run は `resolved_context_snapshot` を残す方針が明記されている。
- [ ] `action_required` が first-class concept として定義されている。
- [ ] Human-in-the-loop は policy/gate/step として扱う方針が明記されている。
- [ ] local / cloud / hybrid runner は二重実装せず、共通 runner entrypoint に接続する方針が明記されている。
- [ ] 最初の MVP は `brainbase-alive` と `/ohayo` run ledger の順に進める方針が明記されている。

## Workflow State Scenarios

VibePro の workflow-heavy Gate に対して、MVPで必ず扱う状態遷移を先に固定する。

### Scenario 1: manual brainbase-alive succeeds

Given workflow owner が `brainbase-alive` を手動実行する。
When `runWorkflow()` が workflow definition、project、owner、context を検証して実行する。
Then `workflow_runs.status=success`、`closure_state=closed`、`action_required=none`、`output_count>=1` が記録される。

### Scenario 2: manual local trigger records local run

Given workflow が local execution として登録されている。
When owner が API または local runner equivalent から手動実行する。
Then runner は `runWorkflow()` を通り、`env=local` の run を ledger に残す。

### Scenario 3: required context is missing

Given workflow に required context source がある。
When run 開始時にその context を解決できない。
Then run は silent failure ではなく `status=needs_action`、`closure_state=needs_action`、`action_required=update_input` または `connect_account` になる。

### Scenario 4: human review is required before external action

Given workflow result がメール送信、SNS投稿、外部公開、本番更新のいずれかを要求する。
When `hitl_policy` が該当 step に一致する。
Then run は `status=waiting_human`、`human_waiting=true` になり、`workflow_human_steps.status=pending` が作成される。

### Scenario 5: human step resumes workflow

Given pending human step が存在する。
When assigned approver または admin が approve を行う。
Then `workflow_human_steps` が解決され、resume path は必ず `runWorkflow()` 経由で run ledger と audit log に戻る。

When assigned approver または admin が reject / cancel を行う。
Then workflow handler は再開されず、元の run は `cancelled` として閉じる。

### Scenario 6: scheduler entrances are future explicit connectors

Given `/ohayo` launchd や Lightsail systemd timer が必要になる。
When 後続 Story で scheduler connector を実装する。
Then scheduler は直接 business logic を呼ばず、`runWorkflow()` に接続し、`trigger_type=local|cron` と `env=local|cloud` を ledger に残す。

## スコープ外

- 複雑な RBAC。
- 複数段階承認。
- Temporal / Airflow / Step Functions のような重厚 workflow engine。
- visual node editor の本格実装。
- local agent polling の本格実装。
- 既存 `/ohayo` / `/oyasumi` / `/retro` の全自動移行。
- launchd / Lightsail systemd timer の実接続。

## 分割 Story

1. `story-workflow-mission-control-foundation`: domain boundary、MVP vocabulary、完成条件を固定する。
2. `story-workflow-project-context-binding`: Session 作成と同じ Project に workflow を所属させ、予定 context と実 context snapshot を定義する。
3. `story-workflow-run-ledger-core-runner`: `runWorkflow()` を唯一の入口にし、success / failure / action_required / audit を記録する。
4. `story-workflow-dashboard-v0`: `/workflows` で health、failed、human waiting、action required、latest runs、context visibility を表示する。
5. `story-workflow-human-in-the-loop`: approval / review / input request を workflow step として扱う。
6. `story-workflow-routine-integration`: `brainbase-alive` と `/ohayo` を最初の routine workflow として ledger に接続する。
