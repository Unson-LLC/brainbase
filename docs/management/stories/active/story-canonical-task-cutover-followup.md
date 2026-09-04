---
story_id: story-canonical-task-cutover-followup
title: Canonical Task cutover follow-up
status: active
created_at: 2026-07-28
updated_at: 2026-07-28
period: 2026-W31
view: engineering
architecture_docs:
  - docs/architecture/ADR-016-canonical-task-single-writer.md
  - docs/architecture/story-companion-canonical-task-provider.md
spec_docs:
  - docs/specs/story-canonical-task-cutover-followup.md
responsibility_authority_docs:
  - docs/responsibility-authority/companion-canonical-task-provider.json
---

# Canonical Task cutover follow-up

## Current reality

WorkflowServiceからAutomationRunServiceへの移行後、承認済みTask候補を正本へmaterializeする処理と、
その処理を再開可能にするPostgres checkpointが移植されていなかった。さらにruntime factoryが
`canonicalTaskService`を受け取らず、依存を構成時に破棄していた。そのためAPIとread経路は存在しても、
Mac Companionからの作成・更新を安全に開通できない。

## Failure modes

- 同じ承認の再送でTaskが重複する。
- NocoDB書き込み後の停止でTask IDがWorkflowへ投影されず、再試行が別Taskを作る。
- 同じ候補へ異なる決定を再送して既存結果を上書きする。
- runtime factoryで依存が欠落し、テスト環境だけ成功して本番経路がmaterializeしない。
- current-HEAD証跡が不足したままmutationを開き、未検証writerを本番へ到達させる。
- collectorを独立worktreeで起動すると、通常discovery用のworktree除外が明示した正本evidence testまで除外し、0件実行を返す。

## Done evidence

- focused Canonical Task materialization/durable checkpoint testが成功する。
- 全Vitestがcurrent HEADで新規失敗なく成功する。
- 独立したgate evidence reviewが変更差分と失敗モードを確認する。
- 本番HEADに対するevidence registry全件とbefore-enable preflightが成功する。
- owner認証されたMac Companionのcreate/update実動確認が成功した場合だけmutationを開通扱いにする。

## Scope

- AutomationRunServiceへ承認materializationとdurable checkpoint/reconciliationを復元する。
- runtime factoryからCanonicalTaskServiceを注入する。
- 旧WorkflowServiceを参照する検証fixtureをAutomationRunServiceへ更新する。
- Canonical Taskのsingle-writer、owner authority、fixed store、readiness設計は変更しない。

## Acceptance criteria

- [x] 承認候補は安定operation keyで一度だけ正本化される。
- [x] prepare/project/complete checkpointから停止後に決定的に再開できる。
- [x] 同一決定は同じ結果を返し、競合する決定は拒否する。
- [x] canonicalTaskService未注入の既存Automation Run互換性を維持する。
- [ ] current-HEADの独立レビューと必須検証を完了する。
- [ ] 本番preflightとowner-auth create/updateを確認後、mutation開通可否を確定する。
- [ ] collectorが注入する`VIBEPRO_EVIDENCE_ID`、`VIBEPRO_EVIDENCE_RESULT`、`VIBEPRO_EVIDENCE_NONCE`がそろい、正本registryが明示するCanonical Task evidence specを実行する場合だけ、独立worktreeから1件のevidence testを収集できる。通常discoveryの`.worktrees`/`.codex-worktrees`除外、registry allowlist、reporter/provenance検証は維持する。

## Architecture decision

新しいADRは不要。今回の変更は
`docs/architecture/ADR-016-canonical-task-single-writer.md` と
`docs/architecture/story-companion-canonical-task-provider.md` が定める既存境界内で、
移行時に欠落したorchestrationを復元するものである。

## Release and rollback

- Operator: Brainbase本番運用者。
- Release: `develop`のmerge commitをデプロイし、systemd serviceの稼働HEADとhealthを確認する。
- Observability: evidence registry結果、preflight JSON、service log、readiness reasonを保存する。
- Enable: current-HEAD証跡とbefore-enable preflightが全件成功した場合だけ明示enableする。
- Rollback: 最初にreadinessを明示disableし、直前の既知正常commitを再デプロイする。旧直接writerは復活させない。
