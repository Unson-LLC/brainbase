# Program external delivery reconciliation v1 Spec

## 正本

- roadmap JSON: `docs/management/milestones/brainbase-program-master-roadmap.json`
- roadmap Markdown: `docs/management/milestones/brainbase-program-master-roadmap.md`
- orchestrator: `docs/management/prompts/codex-brainbase-program-orchestrator.md`
- architecture: `docs/architecture/story-program-external-delivery-reconciliation-v1.md`
- contract test: `tests/contracts/program-external-delivery-reconciliation.test.js`

## 不変条件

1. `status_vocabulary`は`planned`、`contract_ready`、`implementing`、`verified`、`production_proven`、`done`のexact setである。
2. `live_reconciliation.artifacts`のidentityはrepositoryとPRの組で一意で、roleを明記する。
3. A0 producer contract deliveryは`Unson-LLC/brainbase-unson#1302`、merge SHA `ad908bce7b90678f9ed7f1c570f808bdf1a500ad`である。
4. `Unson-LLC/brainbase-unson#1283`はstale title-matched candidateであり、canonical producerまたはcompletion evidenceではない。
5. P0 #1304のsource-lock lineageはupstream repository、PR、role、merge SHAの全てをA0 producer deliveryと一致させる。
6. A0 artifactの`program_effect`は`contract_delivery_only`で、work package、consumer、independent review、Gate、productionを未確定のまま保持する。
7. P0 artifactおよび他external deliveryの`program_effect`はstatus promotionを行わない。
8. reconciliation contractは専用Storyを参照し、P0 Storyのpurpose/AC/Gateを変更しない。
9. contract testのpassはproduction evidenceではない。`production_evidence=not_collected`、`done=false`を維持する。

## live readback境界

Roadmap更新時はGitHub等をreadbackし、取得時刻とsourceを保存する。ただしtestはlive APIの一時状態ではなく、commitされたsnapshot内部のidentity・lineage・status separationを決定論的に検証する。
