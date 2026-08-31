---
title: J0 durable run artifact契約仕様
status: accepted
story_id: story-j0-durable-run-artifact-contract
architecture: docs/architecture/story-j0-durable-run-artifact-contract.md
date: 2026-08-31
---

# J0 durable run artifact契約仕様

## 公開API

- `JUDGMENT_DAG_RUN_ARTIFACT_VERSION`
- `saveJudgmentDAGRunArtifact({ root, record })`
- `loadJudgmentDAGRunArtifact({ root, artifact_id })`
- `JudgmentDAGRunArtifactReceipt`
- `JudgmentDAGArtifactError`と`JudgmentDAGArtifactErrorCode`

save成功は`artifact_id`、`artifact_version`、`run_id`、`status: created | existing`を返す。reload成功は検証済み`JudgmentDAGRunRecord`を返す。

## 検証規則

保存前と再読込時に、recordの許可fieldと型、非空run ID、DAG validation、execution order完全一致、runner versionの一意性、node orderとDAG nodeのrunner/contract一致、direct dependency outputsのID順とoutput一致、JSON値境界を確認する。unknown/missing field、非有限数、循環値、sparse array、非plain objectは拒否する。

再読込はstored envelopeの末尾改行を除くcanonical bytes完全一致と、payloadから再計算したartifact IDの一致を要求する。改ざん、truncation、余分なfield、未知version、wrong embedded/expected IDは成功にしない。

## Filesystem境界

APIはcaller-owned rootだけを受け、artifact locatorは検証済みIDから内部導出する。symlinkまたはnon-regular artifact fileを拒否する。保存は同じartifact IDの完全一致だけを既存successとし、異なるbytesを上書きしない。

## Test plan

1. 実runner recordのsave/reload完全一致とdeep freeze。
2. 同内容を再保存したID/bytes一致。
3. tamper、truncate、wrong ID、unknown version、extra field、malformed recordのfail-closed。
4. caller mutation・reload mutationが次回readbackへ伝播しない。
5. fresh tarball consumerのprocess A save→process B reload。
6. existing runner/public contract、typecheck、buildの回帰。

## 非目標

list、run_id binding、replay、evaluation、version migration、cross-process locking、高度なfault recovery、Graph/DB、hosted storage、MCP/CLI追加、組織版adapter、公開・deployは含めない。
