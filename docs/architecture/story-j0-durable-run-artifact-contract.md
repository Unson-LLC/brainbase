---
title: J0 Durable Run Artifact Contract Architecture
status: accepted
date: 2026-08-31
story_id: story-j0-durable-run-artifact-contract
governed_by: docs/architecture/judgment-dag-core.md
related_adr: ADR-022
---

# J0 durable run artifact設計

## 決定

既存のdeep-frozen `JudgmentDAGRunRecord`を入力に、filesystemを明示的portとして受け取る小さなartifact storeを`./judgment-dag`公開面へ追加する。artifact identityは次で固定する。

```text
payload bytes = canonical JSON({ artifact_version, record })
artifact_id   = "sha256:" + SHA-256(payload bytes)
stored bytes  = canonical JSON({ artifact_id, artifact_version, record }) + "\n"
```

object keyは再帰的にUnicode code point順で並べ、arrayの意味順を保持する。保存時刻、path、環境、乱数、artifact ID自身はdigest preimageへ含めない。J0のcanonicalizationは同一runtime内の安定content addressを目的とし、RFC 8785完全互換やmigration/version negotiationはR1の責務とする。

## 保存と再読込

callerが指定したroot内の`artifacts/<hex>.json`だけを使用する。rootとrecordを検証し、同じdirectory内のtemporary fileへ完全bytesを書いてfileをsyncした後、hard linkによるcreate-once publishを行う。同じartifact IDの既存bytesが完全一致すればidempotent successとし、不一致ならfail-closedにする。公開APIは任意locator、run_id由来path、absolute pathを受け取らない。directory fsyncやcrash phase recoveryはR1に残す。

reloadは`sha256:<64 lowercase hex>`だけを受理し、導出した固定pathからregular fileを読む。JSON envelopeのexact keys、artifact version、embedded ID、canonical stored bytes、payload digest、完全なrun record shapeを検証する。DAGは既存validatorで再検証し、execution order、node order、node contract、direct dependency outputs、runner versionとの整合を確認する。成功時は新しいdeep-frozen snapshotを返す。

## エラーとR1残存責務

`JudgmentDAGArtifactError`は`invalid_request`、`invalid_artifact_id`、`not_found`、`invalid_artifact`、`integrity_mismatch`、`storage_io_error`を安定codeとして返す。生のOS pathや任意parser errorを公開messageへ含めない。

run_idのcreate-once binding、複数artifactのlist/index、cross-process lock、concurrent writer policy、fsync/fault phase、published-unbound recovery、RFC 8785相互運用、schema migration、replay、outcome/evaluation、version comparisonはR1でこのJ0 primitiveを利用して構築する。
