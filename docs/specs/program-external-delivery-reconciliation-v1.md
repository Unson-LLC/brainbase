# Program external delivery reconciliation v1 Spec

## 正本

- roadmap JSON: `docs/management/milestones/brainbase-program-master-roadmap.json`
- roadmap Markdown: `docs/management/milestones/brainbase-program-master-roadmap.md`
- orchestrator: `docs/management/prompts/codex-brainbase-program-orchestrator.md`
- architecture: `docs/architecture/story-program-external-delivery-reconciliation-v1.md`
- Program companion lock: `docs/management/evidence/program-external-delivery-reconciliation-lock-v1.json`
- P0 machine source-lock: `contracts/p0-negative-boundary-contract-v1/source-lock.json`
- contract test: `tests/contracts/program-external-delivery-reconciliation.test.js`

## 不変条件

1. `status_vocabulary`は`planned`、`contract_ready`、`implementing`、`verified`、`production_proven`、`done`のexact setである。
2. `live_reconciliation.artifacts`の全候補はrepositoryとPRの組で一意で、roleを明記する。重複候補はcanonical候補との一致有無に関係なくfail closedにする。
3. A0 producer contract deliveryはrepository=`Unson-LLC/brainbase-unson`、pull_request=`1302`、role=`producer_contract_delivery`、merged_sha=`ad908bce7b90678f9ed7f1c570f808bdf1a500ad`である。canonical選択には`state=MERGED_EXTERNALLY`、完全なmerge provenance、canonical GitHub PR URL、`merged_sha=merge.sha`を必須とし、欠損または矛盾はfail closedにする。`mergeable`と`merge_state_status`は`pre_merge_health`に分離した観測値で、post-merge readbackの`UNKNOWN`はimmutableなmerge provenanceを無効にしない。記録する場合は許容値だけを受け付ける。
4. `Unson-LLC/brainbase-unson#1283`はstale title-matched candidateであり、canonical producerまたはcompletion evidenceではない。
5. P0 machine source-lockのupstream repository/merged SHAを直接読み、Program companion lockがlive readback由来のPRとcanonical role `producer_contract_delivery`を出典付きで結合する。4要素はA0 producer deliveryと一致する。
6. A0 artifactの`program_effect`は`contract_delivery_only`で、work package、consumer、independent review、Gate、productionを未確定のまま保持する。
7. P0 artifactおよび他external deliveryの`program_effect`はstatus promotionを行わない。
8. reconciliation contractは専用Storyを参照し、P0 Storyのpurpose/AC/Gateを変更しない。
9. contract testのpassはproduction evidenceではない。`production_evidence=not_collected`、`done=false`を維持する。

10. 同じPR番号でもrepositoryが異なるidentityをcanonical producerへ採用しない。

11. canonical selectorのownerは`scripts/program/reconcile-external-delivery.mjs`、triggerはexternal delivery readback完了後かつProgram status評価前、failure surfaceは例外を投げるfail-closedとする。呼び出し側は失敗時にreconciliation Gateを`needs_review`として扱い、候補を黙って除外したりProgram statusを昇格したりしない。

## live readback境界

Roadmap更新時はGitHub等をreadbackし、取得時刻とsourceを保存する。ただしtestはlive APIの一時状態ではなく、commitされたsnapshot内部のidentity・lineage・status separationを決定論的に検証する。

## 後継Storyとの依存境界

- successor Story: `story-program-external-delivery-selector-runtime-integration-v1`
- successor status: `planned`
- successor lifecycle: `planning_only`
- successor blocked: `true`。本v1はcontract-onlyであり、runtime owner、実装Task、独立review/GateをこのStoryへ追加しない。
- successor contractの処理順序はactual external delivery readback → selector → Program status評価前で、失敗はfail-closedの`needs_review`とする。selector成功やexternal deliveryから自動promotionしない。
- 本v1と後継Storyのproduction evidenceはそれぞれ`not_collected`であり、後継依存の記録を本番証跡や完了へ昇格させない。
