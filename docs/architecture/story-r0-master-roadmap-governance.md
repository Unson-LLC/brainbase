---
title: R0 Program Master参照境界
status: accepted
date: 2026-09-02
scope: OSS component roadmap governance
---

# R0 Program Master参照境界

## Decision

OSS component roadmapは、`Unson-LLC/brainbase-unson`のProgram Master Roadmapをcross-repositoryの依存順・開始条件・完了条件の上位正本として扱う。ただし、動くbranch名や暗黙の最新状態ではなく、受理済みcommit `18544f58a2a0298d97eab45de2f05544bed48a43`とMarkdown/JSONのcontent SHA-256へ固定する。

## Ownership and dependency direction

- `brainbase-unson`: Program全体のDAG、work package、status vocabulary、Exit Gateを所有する。
- `brainbase`: OSS component内の詳細milestoneと公開Judgment DAG契約を所有し、Program Masterをforkまたは再定義しない。
- 依存方向はcomponentからProgram Masterへの一方向である。OSS packageのruntimeは組織repoを取得・変更しない。

## Source-lock boundary

`contracts/judgment-dag/source-lock.json.program_governance`は次を固定する。

- repository URLとexact commit
- Master Markdownとmachine-readable JSONのrepo相対pathおよびSHA-256
- OSS roadmapに対応するProgram work package crosswalk
- 共通status vocabulary
- snapshot更新時に必要な新commit、両artifact hash、検証証跡、独立review

公開testはこのmetadataとOSS表示面の整合を決定的に検証する。秘密repoのcredentialやnetwork availabilityを公開packageのtest/runtime要件にしない。外部内容のhash照合は、変更準備時の明示的なローカル検証証跡として記録する。

## Update and mismatch policy

Program Master更新へ追随する際は、commitと両content hashを同じ変更で更新し、contract artifactを再生成する。path、hash、crosswalk、statusのいずれかが不一致ならGateはfail closedとし、最新branchへ暗黙追随しない。

## Completion boundary

この変更はgovernance contractを`contract_ready`へ進める。文書merge、静的test、独立reviewだけではProgram R0全体の`done`、runtime成功、production proofを意味しない。Program側のExit Gateと正本status更新は別の証跡として扱う。
